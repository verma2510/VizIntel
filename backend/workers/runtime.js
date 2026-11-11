/**
 * Shared runtime for standalone Kafka consumers.
 *
 * Reliability model (at-least-once + idempotent handlers = effectively-once results):
 *  - Offsets are resolved only AFTER a chunk is processed, then committed — a crash re-delivers, never skips.
 *  - Each chunk is retried with exponential backoff. If it still fails, the chunk is BISECTED into single
 *    events so one poison message can't block or dead-letter its healthy neighbours.
 *  - Messages that are unparseable, fail schema validation, or keep failing are published to the DLQ
 *    with diagnostic headers (original topic/partition/offset, error, group) and the partition moves on.
 *  - A keep-alive heartbeats while slow handlers (LLM calls) run, so the group doesn't rebalance mid-work.
 *  - SIGINT/SIGTERM: stop fetching, finish the in-flight batch, commit, leave the group cleanly.
 */
const http = require("http");
const mongoose = require("mongoose");
const { Partitioners } = require("kafkajs");
const { config, assertConfig } = require("../config/env");
const connectDB = require("../config/db");
const { getKafka, ensureTopics } = require("../lib/kafka");
const { getRedis, closeRedis } = require("../lib/redis");
const eventBus = require("../lib/eventBus");
const { envelopeSchema } = require("../events/schemas");
const { TOPICS } = require("../events/topics");
const { withRetry } = require("../lib/retry");
const rootLogger = require("../lib/logger");

const chunk = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

function decode(message) {
  if (!message.value) return { ok: false, error: new Error("Empty message value (tombstone)") };
  let json;
  try {
    json = JSON.parse(message.value.toString("utf8"));
  } catch (err) {
    return { ok: false, error: new Error(`Unparseable JSON: ${err.message}`) };
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: new Error(`Invalid envelope: ${issues}`) };
  }
  return { ok: true, event: parsed.data };
}

async function startConsumer(subscription) {
  const log = rootLogger.child({ worker: subscription.name, groupId: subscription.groupId });
  const kafka = getKafka();
  const maxAttempts = subscription.maxAttempts || config.worker.maxAttempts;
  const stats = { batches: 0, processed: 0, deadLettered: 0, retries: 0, lastBatchAt: null, lastJoinAt: null, lastError: null, lag: {} };
  let running = false;

  const consumer = kafka.consumer({
    groupId: subscription.groupId,
    sessionTimeout: subscription.sessionTimeout || 30000,
    rebalanceTimeout: Math.max(60000, (subscription.sessionTimeout || 30000) * 2),
    heartbeatInterval: 3000,
    maxBytesPerPartition: 1024 * 1024,
    allowAutoTopicCreation: false,
    retry: { retries: 10 },
  });
  const dlqProducer = kafka.producer({
    idempotent: true,
    maxInFlightRequests: 1,
    allowAutoTopicCreation: false,
    createPartitioner: Partitioners.DefaultPartitioner,
  });

  const { GROUP_JOIN, CRASH, REBALANCING } = consumer.events;
  consumer.on(GROUP_JOIN, ({ payload }) => {
    // (Re)joining the group is the authoritative "healthy" signal — including after KafkaJS auto-restarts.
    running = true;
    stats.lastJoinAt = new Date().toISOString();
    log.info(
      { memberId: payload.memberId, isLeader: payload.isLeader, assignment: payload.memberAssignment },
      "Joined consumer group"
    );
  });
  consumer.on(REBALANCING, () => log.info("Consumer group rebalancing"));
  consumer.on(CRASH, ({ payload }) => {
    // Unhealthy until it rejoins. With restart=false KafkaJS gives up, so exit and let the supervisor
    // (Docker restart policy / Kubernetes) start a fresh process instead of idling as a zombie.
    running = false;
    stats.lastError = payload.error?.message;
    log.error({ err: payload.error?.message, restart: payload.restart }, "Consumer crashed");
    if (!payload.restart) {
      log.fatal("Consumer will not restart; exiting so the process supervisor can replace it");
      setTimeout(() => process.exit(1), 1000).unref();
    }
  });

  async function sendToDlq(topic, partition, items) {
    if (!items.length) return;
    await dlqProducer.send({
      topic: TOPICS.DLQ,
      acks: -1,
      messages: items.map(({ message, error }) => ({
        key: message.key,
        value: message.value,
        headers: {
          ...message.headers,
          "x-original-topic": topic,
          "x-original-partition": String(partition),
          "x-original-offset": String(message.offset),
          "x-consumer-group": subscription.groupId,
          "x-error": String(error?.message || error).slice(0, 1000),
          "x-failed-at": new Date().toISOString(),
        },
      })),
    });
    stats.deadLettered += items.length;
    log.error(
      { topic, partition, count: items.length, offsets: items.map((i) => i.message.offset), err: items[0].error?.message },
      "Messages dead-lettered"
    );
  }

  async function processChunk(topic, partition, items, heartbeat) {
    const context = { topic, partition, transport: "kafka" };
    const retryOptions = (attempts) => ({
      attempts,
      baseMs: 500,
      maxMs: 15000,
      onRetry: (err, attempt, delay) => {
        stats.retries++;
        log.warn({ topic, partition, attempt, delay, size: items.length, err: err.message }, "Handler failed; retrying");
        heartbeat().catch(() => {});
      },
    });

    try {
      await withRetry(() => subscription.handler(items.map((i) => i.event), context), retryOptions(maxAttempts));
      return;
    } catch (err) {
      if (items.length === 1) {
        await sendToDlq(topic, partition, [{ message: items[0].message, error: err }]);
        return;
      }
      log.warn({ topic, partition, size: items.length, err: err.message }, "Chunk failed after retries; bisecting");
    }

    // Isolate the poison event(s): retry each event alone (fewer attempts — the batch already retried).
    for (const item of items) {
      try {
        await withRetry(() => subscription.handler([item.event], context), retryOptions(2));
      } catch (err) {
        await sendToDlq(topic, partition, [{ message: item.message, error: err }]);
      }
      await heartbeat().catch(() => {});
    }
  }

  await withRetry(() => Promise.all([consumer.connect(), dlqProducer.connect()]), {
    attempts: 10,
    baseMs: 1000,
    maxMs: 15000,
    onRetry: (err, attempt) => log.warn({ attempt, err: err.message }, "Kafka not ready; retrying connect"),
  });
  await consumer.subscribe({ topics: subscription.topics, fromBeginning: config.worker.fromBeginning });

  await consumer.run({
    partitionsConsumedConcurrently: subscription.partitionsConsumedConcurrently || 1,
    eachBatchAutoResolve: false,
    autoCommit: true,
    autoCommitInterval: 5000,
    eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
      const { topic, partition, messages } = batch;
      if (!messages.length) return;

      const valid = [];
      const poison = [];
      for (const message of messages) {
        const decoded = decode(message);
        if (decoded.ok) valid.push({ message, event: decoded.event });
        else poison.push({ message, error: decoded.error });
      }
      await sendToDlq(topic, partition, poison);

      // Keep the group membership alive while slow handlers run.
      const keepAlive = setInterval(() => heartbeat().catch(() => {}), 3000);
      let completed = true;
      try {
        for (const items of chunk(valid, subscription.batchSize || 100)) {
          if (!isRunning() || isStale()) {
            completed = false;
            break;
          }
          await processChunk(topic, partition, items, heartbeat);
          resolveOffset(items[items.length - 1].message.offset);
          stats.processed += items.length;
          await heartbeat();
        }
      } finally {
        clearInterval(keepAlive);
      }

      // Covers trailing poison messages (already dead-lettered) after the last valid one.
      if (completed) resolveOffset(batch.lastOffset());
      await commitOffsetsIfNecessary();

      stats.batches++;
      stats.lastBatchAt = new Date().toISOString();
      stats.lag[`${topic}[${partition}]`] = Number(batch.offsetLag());
      log.debug({ topic, partition, size: messages.length, lag: batch.offsetLag() }, "Batch processed");
    },
  });

  log.info({ topics: subscription.topics, batchSize: subscription.batchSize }, "Consumer running");

  return {
    name: subscription.name,
    health: () => ({ name: subscription.name, groupId: subscription.groupId, running, ...stats }),
    stop: async () => {
      running = false;
      await consumer.disconnect().catch((err) => log.warn({ err: err.message }, "Consumer disconnect failed"));
      await dlqProducer.disconnect().catch(() => {});
      log.info("Consumer stopped");
    },
  };
}

function startHealthServer(port, getHealth, log) {
  const server = http.createServer((req, res) => {
    const health = getHealth();
    const healthy = health.workers.every((w) => w.running);
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health));
  });
  // A health endpoint must never take down the consumers it reports on (e.g. port already in use).
  server.on("error", (err) => log.error({ err: err.message, port }, "Worker health endpoint unavailable; consumers keep running"));
  server.listen(port, () => log.info({ port }, "Worker health endpoint listening"));
  return server;
}

/** Boots one or more consumer groups in this process, sharing MongoDB/Redis connections. */
async function bootstrapWorkers(subscriptions) {
  const log = rootLogger.child({ component: "worker", workers: subscriptions.map((s) => s.name) });
  assertConfig(["mongo.uri"]);
  if (!config.kafka.enabled) {
    log.fatal("Standalone workers need Kafka (set KAFKA_BROKERS). Without Kafka the API processes events in-process.");
    process.exit(1);
  }

  await connectDB();
  getRedis(); // insights worker invalidates user caches after writing results
  eventBus.start(); // workers publish follow-up events (e.g. insights.generated)

  await withRetry(() => ensureTopics(log), {
    attempts: 10,
    baseMs: 1000,
    maxMs: 15000,
    onRetry: (err, attempt) => log.warn({ attempt, err: err.message }, "Topic provisioning failed; retrying"),
  });

  const consumers = [];
  for (const subscription of subscriptions) consumers.push(await startConsumer(subscription));

  const getHealth = () => ({
    status: "ok",
    uptimeSec: Math.round(process.uptime()),
    mongo: mongoose.connection.readyState === 1,
    workers: consumers.map((c) => c.health()),
  });
  const healthServer = config.worker.healthPort ? startHealthServer(config.worker.healthPort, getHealth, log) : null;

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "Shutting down workers");
    const forceExit = setTimeout(() => process.exit(1), 30000);
    forceExit.unref();
    try {
      await Promise.all(consumers.map((c) => c.stop()));
      await eventBus.shutdown();
      if (healthServer) healthServer.close();
      await mongoose.disconnect();
      await closeRedis();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => log.error({ err: reason?.message || reason }, "Unhandled rejection"));

  return { consumers, shutdown };
}

/** Entry point helper for the single-purpose worker scripts. */
function runWorkers(subscriptions) {
  bootstrapWorkers(subscriptions).catch((err) => {
    rootLogger.fatal({ err: err.message, stack: err.stack }, "Worker failed to start");
    process.exit(1);
  });
}

module.exports = { bootstrapWorkers, runWorkers, startConsumer, decode };

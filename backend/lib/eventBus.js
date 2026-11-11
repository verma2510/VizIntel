/**
 * Transport-agnostic event bus used by the Express API (producer side) and by workers (to emit
 * follow-up events).
 *
 *  Kafka mode  (KAFKA_BROKERS set): idempotent producer, acks=all, gzip, keyed by user for per-user ordering.
 *  Inline mode (no Kafka):          events are dispatched to in-process handlers — the same handlers the
 *                                   standalone consumers run — so every feature works on a single box.
 *
 * Two delivery policies:
 *  - enqueue(): high-volume activity events go into a bounded in-memory OUTBOX that is micro-batched
 *    (linger ~250ms / up to 500 msgs per produce request). The HTTP request returns 202 as soon as the
 *    event is buffered. If Kafka is down the outbox retries with backoff; when it is full the API applies
 *    BACKPRESSURE (503 + Retry-After) and the browser tracker keeps the events and retries later.
 *  - publish(): critical domain events (dataset uploaded, insights requested/generated) are sent
 *    immediately; if Kafka is unreachable they FALL BACK to in-process handlers so user-visible features
 *    never depend on broker availability. Handlers are idempotent, so a late Kafka delivery of the same
 *    event after a fallback is harmless.
 */
const { CompressionTypes, Partitioners } = require("kafkajs");
const { config } = require("../config/env");
const { getKafka } = require("./kafka");
const { backoffDelay, withRetry, withTimeout } = require("./retry");
const logger = require("./logger").child({ component: "eventBus" });

const inlineHandlers = new Map(); // topic -> [{ name, handler }]
const outbox = []; // [{ topic, event }]
const stats = {
  enqueued: 0,
  published: 0,
  inlineDispatched: 0,
  inlineFallbacks: 0,
  publishFailures: 0,
  dropped: 0,
};

let producer = null;
let producerReady = false;
let connecting = null;
let flushTimer = null;
let flushing = false;
let inFlight = 0; // events taken from the outbox by the current flush attempt
let consecutiveFailures = 0;
let nextFlushAt = 0;
let shuttingDown = false;
// KafkaJS only notices a dead broker on its next request, so `producerReady` alone can report a stale
// "connected". Track the outcome of the last real produce attempt for an honest health signal.
let lastSendFailed = false;
let lastSendError = null;

const markSend = (err) => {
  lastSendFailed = Boolean(err);
  lastSendError = err ? String(err.message || err).slice(0, 200) : null;
};

const mode = () => (config.kafka.enabled ? "kafka" : "inline");

/**
 * Registers in-process handlers from the subscription registry. In inline mode they are the primary
 * processors; in Kafka mode they are only used as the fallback for critical topics.
 */
function registerSubscriptions(subscriptions) {
  for (const subscription of subscriptions) {
    for (const topic of subscription.topics) {
      const handlers = inlineHandlers.get(topic) || [];
      handlers.push({ name: subscription.name, handler: subscription.handler });
      inlineHandlers.set(topic, handlers);
    }
  }
}

async function connectProducer() {
  if (producerReady) return producer;
  if (connecting) return connecting;
  const kafka = getKafka();
  if (!kafka) throw new Error("Kafka is disabled");

  if (!producer) {
    producer = kafka.producer({
      idempotent: true, // broker de-duplicates producer retries (exactly-once per partition on the write path)
      maxInFlightRequests: 1,
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    producer.on(producer.events.DISCONNECT, () => {
      producerReady = false;
      if (!shuttingDown) logger.warn("Kafka producer disconnected; will reconnect on next publish");
    });
  }

  connecting = producer
    .connect()
    .then(() => {
      producerReady = true;
      logger.info({ brokers: config.kafka.brokers }, "Kafka producer connected");
      return producer;
    })
    .finally(() => {
      connecting = null;
    });
  return connecting;
}

const toMessage = (event) => ({
  // Keying by user keeps each user's events ordered within one partition and co-locates them for the
  // aggregator, which rolls metrics up per user/day.
  key: event.userId || event.anonymousId || event.eventId,
  value: JSON.stringify(event),
  timestamp: String(Date.parse(event.occurredAt) || Date.now()),
  headers: {
    "event-id": event.eventId,
    "event-type": event.type,
    "schema-version": String(event.version),
    "content-type": "application/json",
  },
});

/** Runs every in-process handler for a topic; each mirrors an independent consumer group. */
async function dispatchInline(topic, events) {
  const handlers = inlineHandlers.get(topic) || [];
  const results = await Promise.allSettled(
    handlers.map(({ handler }) => handler(events, { topic, transport: "inline" }))
  );
  stats.inlineDispatched += events.length;
  const failures = results
    .map((result, i) => (result.status === "rejected" ? { name: handlers[i].name, reason: result.reason } : null))
    .filter(Boolean);
  if (failures.length) {
    const error = new Error(
      `In-process handler(s) failed for ${topic}: ${failures.map((f) => `${f.name}: ${f.reason?.message}`).join("; ")}`
    );
    error.failures = failures;
    throw error;
  }
}

function groupByTopic(items) {
  const grouped = new Map();
  for (const { topic, event } of items) {
    if (!grouped.has(topic)) grouped.set(topic, []);
    grouped.get(topic).push(event);
  }
  return grouped;
}

function scheduleFlush(delayMs) {
  if (flushTimer || shuttingDown) return;
  const wait = Math.max(delayMs, nextFlushAt - Date.now(), 0);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch((err) => logger.error({ err }, "Unexpected outbox flush error"));
  }, wait);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

/** True when the outbox can take `count` more events (used for HTTP backpressure). */
const hasCapacity = (count = 1) => outbox.length + count <= config.events.outboxMaxSize;

/** Buffers high-volume events for micro-batched delivery. Never throws; reports what was accepted. */
function enqueue(topic, events) {
  if (shuttingDown) return { accepted: 0, rejected: events.length };
  const room = Math.max(0, config.events.outboxMaxSize - outbox.length);
  const accepted = events.slice(0, room);
  for (const event of accepted) outbox.push({ topic, event });
  const rejected = events.length - accepted.length;
  stats.enqueued += accepted.length;
  stats.dropped += rejected;
  if (accepted.length) {
    scheduleFlush(outbox.length >= config.events.flushBatchSize ? 0 : config.events.flushIntervalMs);
  }
  return { accepted: accepted.length, rejected };
}

async function flush() {
  if (flushing || outbox.length === 0) return;
  flushing = true;
  const batch = outbox.splice(0, config.events.flushBatchSize);
  inFlight = batch.length;
  try {
    const byTopic = groupByTopic(batch);
    if (mode() === "kafka") {
      const activeProducer = await withTimeout(connectProducer(), config.kafka.publishTimeoutMs, "Kafka connect timed out");
      await withTimeout(
        activeProducer.sendBatch({
          acks: -1,
          compression: CompressionTypes.GZIP,
          topicMessages: [...byTopic].map(([topic, events]) => ({ topic, messages: events.map(toMessage) })),
        }),
        config.kafka.publishTimeoutMs,
        "Kafka sendBatch timed out"
      );
      stats.published += batch.length;
      markSend(null);
    } else {
      for (const [topic, events] of byTopic) await dispatchInline(topic, events);
    }
    consecutiveFailures = 0;
    nextFlushAt = 0;
  } catch (err) {
    // Put the batch back at the head (preserving order) and retry with exponential backoff.
    consecutiveFailures++;
    stats.publishFailures++;
    if (mode() === "kafka") markSend(err);
    outbox.unshift(...batch);
    const overflow = outbox.length - config.events.outboxMaxSize;
    if (overflow > 0) {
      outbox.splice(config.events.outboxMaxSize, overflow);
      stats.dropped += overflow;
    }
    const delay = backoffDelay(consecutiveFailures, { baseMs: 500, maxMs: 30000 });
    nextFlushAt = Date.now() + delay;
    logger.warn(
      { err: err.message, buffered: outbox.length, retryInMs: delay, attempt: consecutiveFailures },
      "Event flush failed; retrying with backoff"
    );
  } finally {
    flushing = false;
    inFlight = 0;
    if (outbox.length && !shuttingDown) scheduleFlush(config.events.flushIntervalMs);
  }
}

/**
 * Publishes one critical domain event. Resolves with the transport used. In a worker process (no
 * in-process handlers registered) a Kafka failure is re-thrown so the consumer retries the source event.
 */
async function publish(topic, event) {
  if (mode() === "kafka") {
    try {
      const activeProducer = await withTimeout(connectProducer(), config.kafka.publishTimeoutMs, "Kafka connect timed out");
      await withTimeout(
        activeProducer.send({ topic, acks: -1, compression: CompressionTypes.GZIP, messages: [toMessage(event)] }),
        config.kafka.publishTimeoutMs,
        "Kafka send timed out"
      );
      stats.published++;
      markSend(null);
      return { transport: "kafka" };
    } catch (err) {
      stats.publishFailures++;
      markSend(err);
      if (!inlineHandlers.has(topic)) throw err;
      stats.inlineFallbacks++;
      logger.error({ err: err.message, topic, eventId: event.eventId }, "Kafka publish failed; using in-process fallback");
    }
  }

  // Inline mode or fallback: run after the current request has been answered, with retries.
  setImmediate(() => {
    withRetry(() => dispatchInline(topic, [event]), {
      attempts: 3,
      baseMs: 1000,
      onRetry: (err, attempt, delay) =>
        logger.warn({ err: err.message, topic, attempt, delay }, "In-process handler failed; retrying"),
    }).catch((err) =>
      logger.error({ err: err.message, topic, eventId: event.eventId }, "In-process handler failed after retries")
    );
  });
  return { transport: "inline" };
}

/** Fire-and-forget variant for request paths that must never fail because of the event pipeline. */
function publishSafe(topic, event) {
  publish(topic, event).catch((err) =>
    logger.error({ err: err.message, topic, eventId: event.eventId }, "Event publish failed")
  );
}

/** Connects the producer eagerly (non-blocking) so the first request doesn't pay the connect latency. */
function start() {
  if (mode() !== "kafka") {
    logger.info("Kafka disabled - events are processed in-process (inline mode)");
    return;
  }
  connectProducer().catch((err) =>
    logger.warn({ err: err.message }, "Kafka not reachable at startup; will retry on demand")
  );
}

async function shutdown({ timeoutMs = 5000 } = {}) {
  shuttingDown = true;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const deadline = Date.now() + timeoutMs;
  nextFlushAt = 0;
  while (outbox.length && Date.now() < deadline) {
    const before = outbox.length;
    await flush();
    if (outbox.length >= before) break; // flush failing; don't spin until the deadline
  }
  if (outbox.length) logger.warn({ lost: outbox.length }, "Shutting down with undelivered events in outbox");
  if (producer && producerReady) await producer.disconnect().catch(() => {});
  producerReady = false;
}

function health() {
  const kafka = mode() === "kafka";
  return {
    mode: mode(),
    producerReady: kafka ? producerReady : null,
    // True only when the producer is connected AND the most recent produce request succeeded.
    healthy: kafka ? producerReady && !lastSendFailed : true,
    lastError: lastSendError,
    outboxSize: outbox.length + inFlight, // undelivered = buffered + currently being sent
    outboxCapacity: config.events.outboxMaxSize,
    stats: { ...stats },
  };
}

module.exports = { registerSubscriptions, enqueue, hasCapacity, flush, publish, publishSafe, start, shutdown, health };

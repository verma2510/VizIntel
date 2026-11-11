/**
 * Replays dead-lettered messages back onto their original topics after the underlying bug is fixed.
 *   npm run kafka:replay-dlq -- --dry-run
 *   npm run kafka:replay-dlq -- --topic=vizintel.datasets.uploaded --limit=50
 *
 * Safe to run more than once: every handler is idempotent (eventId-keyed upserts / NotificationLog /
 * insightsRequestId guards), so a replayed duplicate is collapsed downstream. The replayer uses its own
 * consumer group, so each run resumes after the last replayed DLQ message.
 */
const { Partitioners } = require("kafkajs");
const { getKafka } = require("../lib/kafka");
const { TOPICS } = require("../events/topics");
const { config } = require("../config/env");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);
const dryRun = Boolean(args["dry-run"]);
const onlyTopic = typeof args.topic === "string" ? args.topic : null;
const limit = Number(args.limit) || 100;
const IDLE_MS = 5000;

async function main() {
  const kafka = getKafka();
  if (!kafka) throw new Error("KAFKA_BROKERS is not set");

  const consumer = kafka.consumer({ groupId: `${config.kafka.topicPrefix}.dlq-replayer` });
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, createPartitioner: Partitioners.DefaultPartitioner });
  await Promise.all([consumer.connect(), producer.connect()]);
  await consumer.subscribe({ topic: TOPICS.DLQ, fromBeginning: true });

  let seen = 0;
  let replayed = 0;
  let idleTimer;
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(finish, IDLE_MS);
  };
  armIdle();

  await consumer.run({
    autoCommit: !dryRun,
    eachMessage: async ({ message }) => {
      armIdle();
      if (replayed >= limit) return finish();
      seen++;
      const header = (name) => message.headers?.[name]?.toString();
      const originalTopic = header("x-original-topic");
      if (!originalTopic || (onlyTopic && originalTopic !== onlyTopic)) return;

      console.log(
        `${dryRun ? "[dry-run] would replay" : "replaying"} offset=${message.offset} -> ${originalTopic} (error: ${header("x-error")})`
      );
      if (!dryRun) {
        const headers = Object.fromEntries(
          Object.entries(message.headers || {}).filter(([k]) => !k.startsWith("x-"))
        );
        headers["x-replayed-at"] = new Date().toISOString();
        await producer.send({ topic: originalTopic, messages: [{ key: message.key, value: message.value, headers }] });
      }
      replayed++;
    },
  });

  await done;
  await consumer.disconnect();
  await producer.disconnect();
  console.log(`Scanned ${seen} DLQ message(s); ${dryRun ? "would replay" : "replayed"} ${replayed}.`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("DLQ replay failed:", err.message);
    process.exit(1);
  }
);

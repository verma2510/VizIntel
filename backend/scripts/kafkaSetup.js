/**
 * Idempotently provisions every Kafka topic (partitions + retention) and prints the resulting layout.
 *   npm run kafka:setup
 * Workers also call ensureTopics() at startup; this script exists for CI/CD and first-time setup.
 */
const { config } = require("../config/env");
const { getKafka, ensureTopics } = require("../lib/kafka");
const { TOPIC_SPECS } = require("../events/topics");
const { withRetry } = require("../lib/retry");
const logger = require("../lib/logger").child({ component: "kafkaSetup" });

async function main() {
  if (!config.kafka.enabled) {
    logger.error("KAFKA_BROKERS is not set - nothing to provision");
    process.exit(1);
  }
  await withRetry(() => ensureTopics(logger), {
    attempts: 15,
    baseMs: 1000,
    maxMs: 10000,
    onRetry: (err, attempt) => logger.warn({ attempt, err: err.message }, "Broker not ready; retrying"),
  });

  const admin = getKafka().admin();
  await admin.connect();
  try {
    const { topics } = await admin.fetchTopicMetadata({ topics: TOPIC_SPECS.map((s) => s.topic) });
    console.table(
      topics.map((t) => {
        const spec = TOPIC_SPECS.find((s) => s.topic === t.name);
        return { topic: t.name, partitions: t.partitions.length, retentionDays: spec.retentionMs / 86400000 };
      })
    );
  } finally {
    await admin.disconnect();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    logger.fatal({ err: err.message }, "Kafka setup failed");
    process.exit(1);
  }
);

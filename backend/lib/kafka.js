/**
 * KafkaJS client factory + idempotent topic provisioning.
 * KafkaJS is pure JavaScript (no librdkafka native build), which keeps Windows/macOS/Alpine installs trivial.
 */
const { Kafka, logLevel } = require("kafkajs");
const { config } = require("../config/env");
const { TOPIC_SPECS } = require("../events/topics");
const logger = require("./logger").child({ component: "kafka" });

const LEVELS = { error: logLevel.ERROR, warn: logLevel.WARN, info: logLevel.INFO, debug: logLevel.DEBUG };
const TO_PINO = {
  [logLevel.ERROR]: "error",
  [logLevel.WARN]: "warn",
  [logLevel.INFO]: "info",
  [logLevel.DEBUG]: "debug",
  [logLevel.NOTHING]: "silent",
};

// Route KafkaJS's internal logs (rebalances, group joins, broker reconnects) into structured pino logs.
const pinoLogCreator = () => ({ namespace, level, log }) => {
  const { message, timestamp, logger: _ignored, ...extra } = log;
  const method = TO_PINO[level] || "info";
  if (method !== "silent") logger[method]({ namespace, ...extra }, message);
};

let kafka = null;

function getKafka() {
  if (!config.kafka.enabled) return null;
  if (kafka) return kafka;
  kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    ssl: config.kafka.ssl,
    sasl: config.kafka.sasl,
    connectionTimeout: config.kafka.connectionTimeout,
    requestTimeout: config.kafka.requestTimeout,
    retry: { initialRetryTime: 300, retries: 8, maxRetryTime: 30000 },
    logLevel: LEVELS[config.kafka.logLevel] ?? logLevel.INFO,
    logCreator: pinoLogCreator,
  });
  return kafka;
}

/**
 * Creates any missing topics with explicit partition counts and retention (auto-creation is disabled on
 * the broker so a typo'd topic name can never silently create a 1-partition topic). Safe to run repeatedly.
 */
async function ensureTopics(log = logger) {
  const client = getKafka();
  if (!client) return false;
  const admin = client.admin();
  await admin.connect();
  try {
    const existing = new Set(await admin.listTopics());
    const missing = TOPIC_SPECS.filter((spec) => !existing.has(spec.topic));
    if (missing.length) {
      await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((spec) => ({
          topic: spec.topic,
          numPartitions: spec.numPartitions,
          replicationFactor: config.kafka.replicationFactor,
          configEntries: [
            { name: "retention.ms", value: String(spec.retentionMs) },
            { name: "cleanup.policy", value: "delete" },
          ],
        })),
      });
      log.info({ topics: missing.map((s) => s.topic) }, "Created Kafka topics");
    }

    const metadata = await admin.fetchTopicMetadata({ topics: TOPIC_SPECS.map((s) => s.topic) });
    for (const topic of metadata.topics) {
      const spec = TOPIC_SPECS.find((s) => s.topic === topic.name);
      if (spec && topic.partitions.length < spec.numPartitions) {
        // Not auto-fixed: adding partitions remaps keys -> partitions and breaks per-user ordering.
        log.warn(
          { topic: topic.name, actual: topic.partitions.length, desired: spec.numPartitions },
          "Topic has fewer partitions than configured; increase manually during a quiet period"
        );
      }
    }
    return true;
  } finally {
    await admin.disconnect();
  }
}

module.exports = { getKafka, ensureTopics };

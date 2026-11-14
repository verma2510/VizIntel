/**
 * Centralised, environment-driven configuration.
 *
 * Every integration (Kafka, Redis, n8n) is OPTIONAL and switched on purely by environment variables,
 * so the original single-process deployment (Express + MongoDB only) keeps working unchanged:
 *   - no KAFKA_BROKERS  -> events are dispatched to in-process handlers ("inline" mode)
 *   - no REDIS_URL      -> caching and rate limiting are bypassed (fail-open)
 *   - no N8N_WEBHOOK_*  -> outbound workflow notifications are skipped
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");

const raw = (name) => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};
const str = (name, fallback) => raw(name) ?? fallback;
const int = (name, fallback) => {
  const parsed = Number.parseInt(raw(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (name, fallback) => {
  const value = raw(name);
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};
const list = (name) =>
  (raw(name) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * TLS settings for the Kafka client.
 *  - KAFKA_SSL=true                 -> TLS using Node's built-in trust store (Confluent Cloud, MSK, Upstash...).
 *  - KAFKA_SSL_CA / KAFKA_SSL_CA_FILE -> TLS trusting a PRIVATE CA (Aiven's per-project "ca.pem"). Setting either
 *    implies TLS. KAFKA_SSL_CA takes the PEM text itself (real newlines or literal "\n" both work, which suits
 *    single-line env var UIs); KAFKA_SSL_CA_FILE takes a path (e.g. a Render Secret File: /etc/secrets/ca.pem).
 */
function kafkaTls() {
  const inline = raw("KAFKA_SSL_CA");
  const file = raw("KAFKA_SSL_CA_FILE");
  if (!inline && !file) return bool("KAFKA_SSL", false);

  const ca = [];
  if (inline) ca.push(inline.replace(/\\n/g, "\n").trim());
  if (file) {
    try {
      ca.push(fs.readFileSync(file, "utf8").trim());
    } catch (err) {
      // Logger depends on config, so use stderr directly here.
      console.error(`[config] Cannot read KAFKA_SSL_CA_FILE (${file}): ${err.message}`);
      process.exit(1);
    }
  }
  return { ca, rejectUnauthorized: true };
}

const nodeEnv = str("NODE_ENV", "development");
const kafkaBrokers = list("KAFKA_BROKERS");
const kafkaEnabled = bool("KAFKA_ENABLED", kafkaBrokers.length > 0);
const redisUrl = raw("REDIS_URL");

const config = {
  nodeEnv,
  isProd: nodeEnv === "production",
  isTest: nodeEnv === "test",
  serviceName: str("SERVICE_NAME", "vizintel-api"),
  port: int("PORT", 5000),
  logLevel: str("LOG_LEVEL", nodeEnv === "production" ? "info" : "debug"),
  logPretty: bool("LOG_PRETTY", nodeEnv !== "production"),
  // Set to "1" (hop count) when running behind Render/NGINX/a load balancer so req.ip is the real client.
  trustProxy: raw("TRUST_PROXY"),
  // Empty => allow any origin (the previous behaviour). Comma-separated list to lock it down.
  corsOrigins: list("CORS_ORIGIN"),
  appUrl: str("APP_URL", "http://localhost:5173"),
  jwtSecret: raw("JWT_SECRET"),

  mongo: {
    uri: raw("MONGO_URI"),
    maxPoolSize: int("MONGO_MAX_POOL_SIZE", 20),
    minPoolSize: int("MONGO_MIN_POOL_SIZE", 2),
    serverSelectionTimeoutMS: int("MONGO_SERVER_SELECTION_TIMEOUT_MS", 10000),
    autoIndex: bool("MONGO_AUTO_INDEX", true),
  },

  ai: {
    apiKey: raw("AI_API_KEY"),
    url: str("AI_API_URL", "https://api.groq.com/openai/v1/chat/completions"),
    model: str("AI_MODEL", "openai/gpt-oss-20b"),
    timeoutMs: int("AI_TIMEOUT_MS", 30000),
  },

  insights: {
    // "sync": generate inside the upload request (original behaviour).
    // "async": return the upload immediately, generate via the insights worker (Kafka) or in-process.
    mode: str("INSIGHTS_MODE", kafkaEnabled ? "async" : "sync") === "async" ? "async" : "sync",
    staleAfterMinutes: int("INSIGHTS_STALE_MINUTES", 10),
    maxAttempts: int("INSIGHTS_MAX_ATTEMPTS", 5),
  },

  upload: {
    maxFileMb: int("UPLOAD_MAX_FILE_MB", 15),
  },

  kafka: {
    enabled: kafkaEnabled,
    brokers: kafkaBrokers.length ? kafkaBrokers : ["localhost:9092"],
    clientId: str("KAFKA_CLIENT_ID", "vizintel"),
    topicPrefix: str("KAFKA_TOPIC_PREFIX", "vizintel"),
    ssl: kafkaTls(),
    // Brokers with a hard topic cap (e.g. Aiven free tier: 5 topics) can share ONE topic for page views, clicks
    // and searches. Events carry their own `type`, so the aggregator doesn't care which topic they arrive on.
    singleActivityTopic: bool("KAFKA_SINGLE_ACTIVITY_TOPIC", false),
    sasl: raw("KAFKA_SASL_MECHANISM")
      ? {
          mechanism: str("KAFKA_SASL_MECHANISM"),
          username: str("KAFKA_SASL_USERNAME", ""),
          password: str("KAFKA_SASL_PASSWORD", ""),
        }
      : undefined,
    connectionTimeout: int("KAFKA_CONNECTION_TIMEOUT_MS", 10000),
    requestTimeout: int("KAFKA_REQUEST_TIMEOUT_MS", 30000),
    replicationFactor: int("KAFKA_REPLICATION_FACTOR", 1),
    activityPartitions: int("KAFKA_ACTIVITY_PARTITIONS", 6),
    logLevel: str("KAFKA_LOG_LEVEL", "info"),
    publishTimeoutMs: int("KAFKA_PUBLISH_TIMEOUT_MS", 8000),
  },

  events: {
    maxClientBatch: int("EVENTS_MAX_CLIENT_BATCH", 50),
    outboxMaxSize: int("EVENTS_OUTBOX_MAX", 10000),
    flushIntervalMs: int("EVENTS_FLUSH_INTERVAL_MS", 250),
    flushBatchSize: int("EVENTS_FLUSH_BATCH", 500),
    rawRetentionDays: int("ACTIVITY_RAW_RETENTION_DAYS", 30),
    maxEventAgeDays: int("ACTIVITY_MAX_EVENT_AGE_DAYS", 7),
  },

  redis: {
    enabled: bool("REDIS_ENABLED", Boolean(redisUrl)),
    url: redisUrl || "redis://localhost:6379",
    keyPrefix: str("REDIS_KEY_PREFIX", `vizintel:${nodeEnv}:`),
  },

  cache: {
    maxItemBytes: int("CACHE_MAX_ITEM_BYTES", 2 * 1024 * 1024),
    ttl: {
      datasetList: int("CACHE_TTL_DATASET_LIST", 120),
      dataset: int("CACHE_TTL_DATASET", 600),
      summary: int("CACHE_TTL_SUMMARY", 60),
      analytics: int("CACHE_TTL_ANALYTICS", 300),
      activity: int("CACHE_TTL_ACTIVITY", 30),
      columnClassification: int("CACHE_TTL_COLUMN_CLASSIFICATION", 7 * 24 * 3600),
      sharedDashboard: int("CACHE_TTL_SHARED_DASHBOARD", 60),
    },
  },

  rateLimit: {
    enabled: bool("RATE_LIMIT_ENABLED", true),
    eventsPerMinute: int("RATE_LIMIT_EVENTS_PER_MIN", 240),
    authPerMinute: int("RATE_LIMIT_AUTH_PER_MIN", 30),
    uploadsPerMinute: int("RATE_LIMIT_UPLOADS_PER_MIN", 10),
    aiPerMinute: int("RATE_LIMIT_AI_PER_MIN", 20),
    publicPerMinute: int("RATE_LIMIT_PUBLIC_PER_MIN", 60),
  },

  n8n: {
    webhooks: {
      datasetUploaded: raw("N8N_WEBHOOK_DATASET_UPLOADED"),
      insightsGenerated: raw("N8N_WEBHOOK_INSIGHTS_GENERATED"),
    },
    secret: raw("N8N_WEBHOOK_SECRET"),
    timeoutMs: int("N8N_TIMEOUT_MS", 10000),
    maxAttempts: int("N8N_MAX_ATTEMPTS", 3),
  },

  internalApiKey: raw("INTERNAL_API_KEY"),

  worker: {
    healthPort: int("WORKER_HEALTH_PORT", 0),
    maxAttempts: int("WORKER_MAX_ATTEMPTS", 5),
    // Only applies to partitions with NO committed offset for the group (auto.offset.reset=earliest).
    // Must stay true: with "latest", events produced while a group had no offset on a partition
    // (first deploy, or a partition not yet consumed when a consumer rejoins) would be silently skipped.
    // Safe because every handler is idempotent.
    fromBeginning: bool("WORKER_FROM_BEGINNING", true),
  },
};

/**
 * Fail fast on missing configuration that the process cannot work without.
 * Accepts dotted paths into `config`, e.g. ["mongo.uri", "jwtSecret"].
 */
function assertConfig(paths) {
  const missing = paths.filter((path) => {
    const value = path.split(".").reduce((obj, key) => (obj == null ? undefined : obj[key]), config);
    return value === undefined || value === null || value === "";
  });
  if (missing.length) {
    // Logger depends on config, so use stderr directly here.
    console.error(`[config] Missing required configuration: ${missing.join(", ")}`);
    process.exit(1);
  }
}

module.exports = { config, assertConfig };

/**
 * Shared ioredis client. Configured to FAIL FAST rather than queue: when Redis is down, commands reject
 * immediately (enableOfflineQueue: false) and callers bypass the cache instead of hanging requests.
 */
const Redis = require("ioredis");
const { config } = require("../config/env");
const logger = require("./logger").child({ component: "redis" });

let client = null;
let lastErrorLogAt = 0;

function getRedis() {
  if (!config.redis.enabled) return null;
  if (client) return client;

  client = new Redis(config.redis.url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    // Reconnect forever with capped backoff; the app keeps serving (uncached) in the meantime.
    retryStrategy: (times) => Math.min(times * 500, 10000),
  });

  client.on("ready", () => logger.info("Redis connection ready"));
  client.on("end", () => logger.warn("Redis connection closed"));
  client.on("error", (err) => {
    // ioredis emits an error per reconnect attempt; throttle to keep logs readable during an outage.
    if (Date.now() - lastErrorLogAt > 30000) {
      lastErrorLogAt = Date.now();
      logger.warn({ err: err.message }, "Redis unavailable - caching and rate limiting bypassed");
    }
  });

  return client;
}

/** Returns the client only when it can serve commands right now, else null. */
function readyClient() {
  const redis = getRedis();
  return redis && redis.status === "ready" ? redis : null;
}

async function closeRedis() {
  if (!client) return;
  const current = client;
  client = null;
  try {
    await current.quit();
  } catch {
    current.disconnect();
  }
}

function redisStatus() {
  return { enabled: config.redis.enabled, status: client ? client.status : "disabled" };
}

module.exports = { getRedis, readyClient, closeRedis, redisStatus };

/**
 * Cache-aside helpers on top of Redis.
 *
 * Design:
 *  - Values are stored as serialized JSON strings so a cache HIT can be streamed straight to the HTTP
 *    response (no JSON.parse/JSON.stringify round trip for multi-MB dataset payloads).
 *  - Per-user namespace versioning: every user-scoped key embeds `v<N>`. Invalidating ALL of a user's
 *    cached views (list pages, search results, summary, analytics, dataset bodies) is a single INCR —
 *    no KEYS/SCAN, no need to know which query-string variants were cached. Orphaned keys age out via TTL.
 *  - Single-flight: concurrent misses for the same key share one loader call (stampede protection).
 *  - TTL jitter (+0-10%) so keys written together don't expire together.
 *  - Fail-open: any Redis problem degrades to calling the loader directly.
 */
const crypto = require("crypto");
const { config } = require("../config/env");
const { readyClient } = require("./redis");
const logger = require("./logger").child({ component: "cache" });

const inflight = new Map();
const stats = { hits: 0, misses: 0, bypass: 0, errors: 0, sets: 0, skippedTooLarge: 0, coalesced: 0 };
const USER_VERSION_TTL_SEC = 7 * 24 * 3600;

const key = (...parts) => config.redis.keyPrefix + parts.join(":");

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => ({ ...acc, [k]: sortKeys(value[k]) }), {});
  }
  return value;
};

/** Stable short hash of query params so `?q=a&page=1` and `?page=1&q=a` share a key. */
const hashParams = (params) =>
  crypto.createHash("sha1").update(JSON.stringify(sortKeys(params || {}))).digest("hex").slice(0, 16);

const withJitter = (ttlSec) => Math.max(1, Math.round(ttlSec * (1 + Math.random() * 0.1)));

async function getRaw(cacheKey) {
  const redis = readyClient();
  if (!redis || !cacheKey) {
    stats.bypass++;
    return { value: null, available: false };
  }
  try {
    const value = await redis.get(cacheKey);
    if (value === null) stats.misses++;
    else stats.hits++;
    return { value, available: true };
  } catch (err) {
    stats.errors++;
    logger.debug({ err: err.message, cacheKey }, "cache get failed");
    return { value: null, available: false };
  }
}

async function setRaw(cacheKey, json, ttlSec) {
  const redis = readyClient();
  if (!redis || !cacheKey || typeof json !== "string") return false;
  if (Buffer.byteLength(json) > config.cache.maxItemBytes) {
    stats.skippedTooLarge++;
    return false;
  }
  try {
    await redis.set(cacheKey, json, "EX", withJitter(ttlSec));
    stats.sets++;
    return true;
  } catch (err) {
    stats.errors++;
    logger.debug({ err: err.message, cacheKey }, "cache set failed");
    return false;
  }
}

async function getJSON(cacheKey) {
  const { value } = await getRaw(cacheKey);
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const setJSON = (cacheKey, value, ttlSec) => setRaw(cacheKey, JSON.stringify(value), ttlSec);

async function del(...cacheKeys) {
  const redis = readyClient();
  if (!redis || cacheKeys.length === 0) return 0;
  try {
    return await redis.del(...cacheKeys);
  } catch (err) {
    stats.errors++;
    return 0;
  }
}

/**
 * Cache-aside with single-flight. Returns { json, status } where status is HIT | MISS | BYPASS.
 * The loader's thrown errors (e.g. NotFoundError) propagate and are never cached.
 */
async function remember(cacheKey, ttlSec, loader) {
  const { value, available } = await getRaw(cacheKey);
  if (value !== null) return { json: value, status: "HIT" };

  const run = async () => {
    const result = await loader();
    const json = JSON.stringify(result === undefined ? null : result);
    if (available) await setRaw(cacheKey, json, ttlSec);
    return { json, status: available ? "MISS" : "BYPASS" };
  };

  if (!cacheKey) return run();
  if (inflight.has(cacheKey)) {
    stats.coalesced++;
    return inflight.get(cacheKey);
  }
  const promise = run().finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, promise);
  return promise;
}

/** Namespace prefix for a user's cache entries, e.g. "vizintel:production:u:<id>:v3". Null if Redis is down. */
async function userNamespace(userId) {
  const redis = readyClient();
  if (!redis) return null;
  try {
    const version = await redis.get(key("u", userId, "ver"));
    return key("u", userId, `v${version || 0}`);
  } catch {
    return null;
  }
}

/** Builds a versioned user-scoped key, or null (=> bypass) when Redis is unavailable. */
async function userKey(userId, ...parts) {
  const namespace = await userNamespace(userId);
  return namespace ? [namespace, ...parts].join(":") : null;
}

/** O(1) invalidation of every cached view belonging to a user. */
async function invalidateUser(userId) {
  const redis = readyClient();
  if (!redis || !userId) return false;
  try {
    const versionKey = key("u", String(userId), "ver");
    await redis.multi().incr(versionKey).expire(versionKey, USER_VERSION_TTL_SEC).exec();
    return true;
  } catch (err) {
    stats.errors++;
    logger.warn({ err: err.message, userId }, "cache invalidation failed; entries will expire via TTL");
    return false;
  }
}

/** Writes a cached/remembered result to an Express response with an X-Cache header. */
function sendCached(res, { json, status }, httpStatus = 200) {
  res.set("X-Cache", status);
  res.status(httpStatus).type("application/json").send(json);
}

function cacheStats() {
  const lookups = stats.hits + stats.misses;
  return { ...stats, hitRatio: lookups ? Number((stats.hits / lookups).toFixed(3)) : null };
}

module.exports = {
  key,
  hashParams,
  getRaw,
  setRaw,
  getJSON,
  setJSON,
  del,
  remember,
  userNamespace,
  userKey,
  invalidateUser,
  sendCached,
  cacheStats,
};

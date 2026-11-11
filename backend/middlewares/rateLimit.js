const { config } = require("../config/env");
const { readyClient } = require("../lib/redis");
const logger = require("../lib/logger").child({ component: "rateLimit" });

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE in one MULTI), so limits hold across every
 * API instance behind a load balancer — an in-memory limiter would give each instance its own budget.
 * Fails OPEN: if Redis is unavailable requests are allowed (availability over strictness).
 */
function rateLimit({ name, max, windowSec = 60, keyFn = (req) => req.user?.id || req.ip }) {
  return async function rateLimitMiddleware(req, res, next) {
    const redis = config.rateLimit.enabled ? readyClient() : null;
    if (!redis) return next();

    const window = Math.floor(Date.now() / 1000 / windowSec);
    const key = `${config.redis.keyPrefix}rl:${name}:${keyFn(req)}:${window}`;
    try {
      const [[, count]] = await redis.multi().incr(key).expire(key, windowSec).exec();
      const resetInSec = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
      res.set("RateLimit-Limit", String(max));
      res.set("RateLimit-Remaining", String(Math.max(0, max - count)));
      res.set("RateLimit-Reset", String(resetInSec));
      if (count > max) {
        res.set("Retry-After", String(resetInSec));
        return res.status(429).json({ msg: "Too many requests, please slow down." });
      }
    } catch (err) {
      logger.debug({ err: err.message, name }, "rate limiter unavailable; allowing request");
    }
    next();
  };
}

module.exports = rateLimit;

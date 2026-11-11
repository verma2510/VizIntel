const { z } = require("zod");
const activityService = require("../services/activityService");
const cache = require("../lib/cache");
const { config } = require("../config/env");

const daysSchema = z.coerce.number().int().min(1).max(90).default(7);

/**
 * GET /api/activity/summary?days=7 — the user's interaction metrics as rolled up by the Kafka consumer.
 * Activity changes continuously, so this uses a short TTL-only key (not the versioned namespace).
 */
exports.getSummary = async (req, res) => {
  const days = daysSchema.parse(req.query.days);
  const cacheKey = cache.key("u", req.user.id, "activity", String(days));
  const result = await cache.remember(cacheKey, config.cache.ttl.activity, () =>
    activityService.getUserActivitySummary(req.user.id, days)
  );
  cache.sendCached(res, result);
};

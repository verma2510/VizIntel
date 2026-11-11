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

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.date().optional(),
  type: z.enum(["page_view", "click", "search", "dataset_uploaded"]).optional(),
});

/** GET /api/activity/events?limit=50&before=<iso>&type=click — the user's recent interaction timeline. */
exports.getEvents = async (req, res) => {
  const query = eventsQuerySchema.parse(req.query);
  res.json(await activityService.listRecentEvents(req.user.id, query));
};

const analyticsService = require("../services/analyticsService");
const cache = require("../lib/cache");
const { config } = require("../config/env");

// Both endpoints are cache-aside (Redis). Keys live in the user's versioned namespace, so a new upload
// or a finished insight generation invalidates them instantly. NotFoundError -> 404 via errorHandler.

exports.getDatasetAnalytics = async (req, res) => {
  const { id } = req.params;
  const cacheKey = await cache.userKey(req.user.id, "analytics", id);
  const result = await cache.remember(cacheKey, config.cache.ttl.analytics, () =>
    analyticsService.generateAdvancedAnalytics(id, req.user.id)
  );
  cache.sendCached(res, result);
};

exports.getDashboardSummary = async (req, res) => {
  const cacheKey = await cache.userKey(req.user.id, "summary");
  const result = await cache.remember(cacheKey, config.cache.ttl.summary, () =>
    analyticsService.getDashboardSummary(req.user.id)
  );
  cache.sendCached(res, result);
};

const activityService = require("../../services/activityService");
const logger = require("../../lib/logger").child({ component: "activityHandler" });

/** Batch handler for page views, clicks, searches and dataset uploads -> idempotent daily rollups. */
async function handleActivityEvents(events, context = {}) {
  const result = await activityService.ingestEvents(events);
  logger.debug({ ...result, topic: context.topic, transport: context.transport }, "Activity batch aggregated");
  return result;
}

module.exports = { handleActivityEvents };

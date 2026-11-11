const insightsService = require("../../services/insightsService");
const logger = require("../../lib/logger").child({ component: "insightsHandler" });

/** One LLM call per event; parallelism comes from partitions/instances, not from within a batch. */
async function handleInsightsRequests(events) {
  for (const event of events) {
    const result = await insightsService.processInsightsRequest(event);
    logger.info({ eventId: event.eventId, datasetId: event.data?.datasetId, ...result }, "Insights request handled");
  }
}

module.exports = { handleInsightsRequests };

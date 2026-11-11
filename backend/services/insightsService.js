/**
 * AI insight generation lifecycle: pending -> ready | failed.
 *
 * In "sync" mode the upload request calls generate() directly (original behaviour). In "async" mode the
 * upload publishes `insights.requested` and the insights worker calls processInsightsRequest().
 */
const Dataset = require("../models/Dataset");
const cache = require("../lib/cache");
const eventBus = require("../lib/eventBus");
const { TOPICS } = require("../events/topics");
const { buildEnvelope } = require("../events/schemas");
const { withRetry, isTransientHttpError } = require("../lib/retry");
const { toObjectId } = require("../lib/mongoHelpers");
const { generateInsightsStrict, INSIGHTS_FALLBACK_MESSAGE } = require("../utils/aiInsights");
const logger = require("../lib/logger").child({ component: "insightsService" });

/** Short, storable description of an LLM failure (never includes request headers / API key). */
function describeError(err) {
  if (err?.response) {
    const body = typeof err.response.data === "string" ? err.response.data : JSON.stringify(err.response.data || {});
    return `HTTP ${err.response.status}: ${body.slice(0, 300)}`;
  }
  return String(err?.message || err).slice(0, 300);
}

/** Single attempt, never throws — used in the synchronous upload path to keep latency bounded. */
async function generate(kpis, columns) {
  try {
    return { ok: true, text: await generateInsightsStrict(kpis, columns) };
  } catch (err) {
    const error = describeError(err);
    logger.warn({ error }, "Insight generation failed");
    return { ok: false, text: INSIGHTS_FALLBACK_MESSAGE, error };
  }
}

async function emitGenerated(dataset, requestId, status) {
  await eventBus.publish(
    TOPICS.INSIGHTS_GENERATED,
    buildEnvelope({
      // Deterministic id: a retried/redelivered request re-emits the SAME event, which the notifier dedupes.
      eventId: `insights-generated:${requestId}`,
      type: "insights_generated",
      userId: String(dataset.user),
      source: "worker",
      data: { datasetId: String(dataset._id), requestId, status },
    })
  );
}

/**
 * Handles one `insights.requested` event. Idempotent and race-safe:
 *  - a request whose requestId no longer matches the dataset was superseded by a newer one -> skipped
 *  - a request already resolved (redelivery) -> only re-emits the completion event
 *  - the final write is conditional on insightsRequestId, so a slow stale worker can't overwrite newer results
 * LLM failures are recorded as status "failed" (not thrown) so n8n's sweeper can retry them later;
 * only infrastructure errors (MongoDB/Kafka) throw and trigger consumer-level retry / DLQ.
 */
async function processInsightsRequest(event) {
  const { datasetId, requestId } = event.data || {};
  const oid = toObjectId(datasetId);
  if (!oid || !requestId) return { outcome: "invalid" };

  const dataset = await Dataset.findById(oid, {
    kpis: 1,
    columns: 1,
    user: 1,
    insightsStatus: 1,
    insightsRequestId: 1,
  }).lean();
  if (!dataset) return { outcome: "not_found" };
  if (dataset.insightsRequestId !== requestId) return { outcome: "superseded" };
  if (dataset.insightsStatus !== "pending") {
    await emitGenerated(dataset, requestId, dataset.insightsStatus);
    return { outcome: "already_processed" };
  }

  const startedAt = Date.now();
  let update;
  try {
    const text = await withRetry(() => generateInsightsStrict(dataset.kpis, dataset.columns), {
      attempts: 3,
      baseMs: 2000,
      maxMs: 10000,
      shouldRetry: isTransientHttpError,
      onRetry: (err, attempt, delay) =>
        logger.warn({ datasetId, attempt, delay, error: describeError(err) }, "LLM call failed; retrying"),
    });
    update = {
      $set: { insights: text, insightsStatus: "ready", insightsUpdatedAt: new Date() },
      $unset: { insightsError: "" },
    };
  } catch (err) {
    update = {
      $set: {
        insights: INSIGHTS_FALLBACK_MESSAGE,
        insightsStatus: "failed",
        insightsError: describeError(err),
        insightsUpdatedAt: new Date(),
      },
    };
  }

  const updated = await Dataset.findOneAndUpdate({ _id: oid, insightsRequestId: requestId }, update, {
    returnDocument: "after",
    projection: { user: 1, insightsStatus: 1 },
  }).lean();
  if (!updated) return { outcome: "superseded" };

  await cache.invalidateUser(String(updated.user));
  await emitGenerated(updated, requestId, updated.insightsStatus);
  logger.info({ datasetId, requestId, status: updated.insightsStatus, ms: Date.now() - startedAt }, "Insights processed");
  return { outcome: updated.insightsStatus };
}

module.exports = { generate, processInsightsRequest, describeError };

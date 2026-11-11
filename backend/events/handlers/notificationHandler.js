/**
 * Bridges domain events to n8n workflows.
 *
 * Events on Kafka carry only ids (no email addresses / PII). The notifier enriches them at send time from
 * MongoDB, so the n8n payload always reflects current data and the event log stays free of personal data.
 * Delivery is de-duplicated through NotificationLog (keyed by eventId + channel): a redelivered event that
 * was already sent is skipped, so users never receive duplicate emails.
 */
const User = require("../../models/User");
const Dataset = require("../../models/Dataset");
const NotificationLog = require("../../models/NotificationLog");
const { postWebhook } = require("../../lib/n8n");
const { config } = require("../../config/env");
const { toObjectId } = require("../../lib/mongoHelpers");
const logger = require("../../lib/logger").child({ component: "notificationHandler" });

const datasetUrl = (id) => `${config.appUrl}/dashboard?dataset=${id}`;

async function loadUser(userId) {
  const oid = toObjectId(userId);
  return oid ? User.findById(oid, { name: 1, email: 1 }).lean() : null;
}

/** Splits the LLM's markdown bullet list into plain sentences for email templates. */
function extractBullets(markdown) {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 10);
}

async function buildDatasetUploadedPayload(event) {
  const user = await loadUser(event.userId);
  const data = event.data || {};
  const datasetOid = toObjectId(data.datasetId);
  if (!user || !datasetOid) return null;
  const dataset = await Dataset.findById(datasetOid, { kpis: 1 }).lean();
  if (!dataset) return null;

  const topKpis = Object.entries(dataset.kpis || {})
    .slice(0, 4)
    .map(([name, metrics]) => ({ name, sum: metrics.sum, avg: metrics.avg, semanticType: metrics.semanticType }));

  return {
    event: "dataset.uploaded",
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    user: { id: String(user._id), name: user.name, email: user.email },
    dataset: {
      id: data.datasetId,
      name: data.name,
      rowCount: data.rowCount,
      columnCount: data.columnCount,
      kpiCount: data.kpiCount,
      chartCount: data.chartCount,
      insightsStatus: data.insightsStatus,
      classificationSource: data.classificationSource,
      processingMs: data.processingMs,
      topKpis,
      url: datasetUrl(data.datasetId),
    },
    // n8n's "AI insight trigger" branch fires when the synchronous generation already failed.
    actions: { regenerateInsights: data.insightsStatus === "failed" },
  };
}

async function buildInsightsGeneratedPayload(event) {
  const user = await loadUser(event.userId);
  const data = event.data || {};
  const datasetOid = toObjectId(data.datasetId);
  if (!user || !datasetOid) return null;
  const dataset = await Dataset.findById(datasetOid, { name: 1, insights: 1 }).lean();
  if (!dataset) return null;

  const ready = data.status === "ready";
  return {
    event: "insights.generated",
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    user: { id: String(user._id), name: user.name, email: user.email },
    dataset: { id: data.datasetId, name: dataset.name, url: datasetUrl(data.datasetId) },
    insights: {
      status: data.status,
      requestId: data.requestId,
      text: ready ? dataset.insights : null,
      bullets: ready ? extractBullets(dataset.insights) : [],
    },
  };
}

const ROUTES = {
  dataset_uploaded: {
    channel: "n8n:dataset-uploaded",
    url: () => config.n8n.webhooks.datasetUploaded,
    build: buildDatasetUploadedPayload,
  },
  insights_generated: {
    channel: "n8n:insights-generated",
    url: () => config.n8n.webhooks.insightsGenerated,
    build: buildInsightsGeneratedPayload,
  },
};

async function deliver(event) {
  const route = ROUTES[event.type];
  if (!route) return "ignored";
  const url = route.url();
  if (!url) return "not_configured";

  const logId = `${event.eventId}:${route.channel}`;
  const record = await NotificationLog.findOneAndUpdate(
    { _id: logId },
    { $setOnInsert: { eventId: event.eventId, channel: route.channel, status: "pending", attempts: 0, createdAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  ).lean();
  if (record.status === "sent" || record.status === "skipped") return "duplicate";

  const payload = await route.build(event);
  if (!payload) {
    await NotificationLog.updateOne({ _id: logId }, { $set: { status: "skipped", lastError: "user or dataset no longer exists" } });
    return "skipped";
  }

  try {
    await postWebhook(url, payload, { idempotencyKey: event.eventId });
    await NotificationLog.updateOne({ _id: logId }, { $set: { status: "sent", sentAt: new Date() }, $inc: { attempts: 1 } });
    return "sent";
  } catch (err) {
    await NotificationLog.updateOne(
      { _id: logId },
      { $set: { status: "failed", lastError: String(err.message).slice(0, 500) }, $inc: { attempts: 1 } }
    );
    throw err; // consumer retries with backoff, then dead-letters
  }
}

/** Sequential on purpose: preserves per-user ordering and bounds concurrent calls into n8n. */
async function handleNotificationEvents(events) {
  for (const event of events) {
    const outcome = await deliver(event);
    logger.info({ eventId: event.eventId, type: event.type, outcome }, "Notification processed");
  }
}

module.exports = { handleNotificationEvents, extractBullets, buildDatasetUploadedPayload, buildInsightsGeneratedPayload };

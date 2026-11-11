/**
 * Dataset business logic (previously inlined in datasetController). Owns:
 *  - the upload pipeline (parse -> classify -> KPIs/charts -> insights -> persist -> events)
 *  - cached read paths (list/search, detail) with per-user cache invalidation
 *  - insight regeneration requests (from the UI or from n8n)
 */
const crypto = require("crypto");
const Dataset = require("../models/Dataset");
const { analyzeData, buildKpisAndCharts } = require("../utils/dataAnalyzer");
const { classifyColumnsDetailed } = require("../utils/columnClassifier");
const insightsService = require("./insightsService");
const cache = require("../lib/cache");
const eventBus = require("../lib/eventBus");
const { TOPICS } = require("../events/topics");
const { buildEnvelope } = require("../events/schemas");
const { config } = require("../config/env");
const { BadRequestError, NotFoundError } = require("../lib/errors");
const { toObjectId, escapeRegex, rowCountExpr, columnCountExpr } = require("../lib/mongoHelpers");
const logger = require("../lib/logger").child({ component: "datasetService" });

// Internal bookkeeping that clients never need to see.
const INTERNAL_FIELDS = { insightsRequestId: 0, insightsError: 0, insightsAttempts: 0 };

/** Normalises legacy documents (pre-dating insightsStatus/rowCount) so clients always see one shape. */
function withDefaults(doc) {
  const { insightsRequestId, insightsError, insightsAttempts, ...rest } = doc;
  return {
    ...rest,
    insightsStatus: rest.insightsStatus || "ready",
    rowCount: rest.rowCount ?? (Array.isArray(rest.originalData) ? rest.originalData.length : undefined),
    columnCount: rest.columnCount ?? (Array.isArray(rest.columns) ? rest.columns.length : undefined),
  };
}

/**
 * Column classification is the first LLM call of every upload. Repeat uploads of the same report
 * template (same column names + structural types) reuse a cached classification instead of a fresh call.
 * Only genuine LLM results are cached — heuristic fallbacks (LLM outage) are not.
 */
async function classifyWithCache(structuralColumns, data) {
  const signature = crypto
    .createHash("sha256")
    .update(JSON.stringify(structuralColumns.map((c) => [c.name, c.type])))
    .digest("hex");
  const cacheKey = cache.key("colclass", signature);

  const cached = await cache.getJSON(cacheKey);
  if (Array.isArray(cached) && cached.length === structuralColumns.length) {
    return { columns: cached, source: "cache" };
  }
  const result = await classifyColumnsDetailed(structuralColumns, data);
  if (result.source === "llm") {
    await cache.setJSON(cacheKey, result.columns, config.cache.ttl.columnClassification);
  }
  return result;
}

const countBy = (items, field) =>
  items.reduce((acc, item) => ({ ...acc, [item[field]]: (acc[item[field]] || 0) + 1 }), {});

async function createDataset({ userId, file }) {
  const startedAt = Date.now();

  let parsed;
  try {
    parsed = analyzeData(file.buffer);
  } catch (err) {
    throw new BadRequestError(`Error reading or analyzing the file: ${err.message}`);
  }
  const { data, columns: structuralColumns } = parsed;

  // 1. Semantic column meaning (LLM, cached by column signature, heuristic fallback)
  const { columns: semanticInfo, source: classificationSource } = await classifyWithCache(structuralColumns, data);
  const columns = structuralColumns.map((col, idx) => ({
    ...col,
    semanticType: semanticInfo[idx].semanticType,
    label: semanticInfo[idx].label,
  }));

  // 2. KPIs + chart definitions
  const { kpis, charts } = buildKpisAndCharts(data, columns);

  // 3. Insights: inline (sync, original behaviour) or deferred to the insights worker (async)
  const asyncInsights = config.insights.mode === "async";
  const insightsRequestId = crypto.randomUUID();
  let insightsFields;
  if (asyncInsights) {
    insightsFields = { insights: "", insightsStatus: "pending", insightsAttempts: 1 };
  } else {
    const result = await insightsService.generate(kpis, columns);
    insightsFields = {
      insights: result.text,
      insightsStatus: result.ok ? "ready" : "failed",
      insightsError: result.error,
      insightsAttempts: 1,
      insightsUpdatedAt: new Date(),
    };
  }

  // 4. Persist
  const saved = await Dataset.create({
    user: userId,
    name: file.originalname,
    originalData: data,
    columns,
    kpis,
    charts,
    rowCount: data.length,
    columnCount: columns.length,
    insightsRequestId,
    ...insightsFields,
  });
  const datasetId = String(saved._id);

  // 5. Invalidate every cached view for this user (list, search, summary, analytics) in O(1)
  await cache.invalidateUser(userId);

  // 6. Domain events — fire-and-forget; the upload never fails or waits because of the event pipeline.
  const processingMs = Date.now() - startedAt;
  eventBus.publishSafe(
    TOPICS.DATASET_UPLOADED,
    buildEnvelope({
      eventId: `dataset-uploaded:${datasetId}`,
      type: "dataset_uploaded",
      userId,
      source: "api",
      data: {
        datasetId,
        name: saved.name,
        rowCount: data.length,
        columnCount: columns.length,
        fileSizeBytes: file.size,
        kpiCount: Object.keys(kpis).length,
        chartCount: charts.length,
        semanticTypes: countBy(columns, "semanticType"),
        classificationSource,
        insightsStatus: insightsFields.insightsStatus,
        processingMs,
      },
    })
  );
  if (asyncInsights) {
    eventBus.publishSafe(
      TOPICS.INSIGHTS_REQUESTED,
      buildEnvelope({
        eventId: `insights-requested:${insightsRequestId}`,
        type: "insights_requested",
        userId,
        source: "api",
        data: { datasetId, requestId: insightsRequestId, reason: "upload" },
      })
    );
  }

  logger.info(
    { datasetId, rows: data.length, columns: columns.length, classificationSource, insightsMode: config.insights.mode, processingMs },
    "Dataset processed"
  );
  return withDefaults(saved.toJSON());
}

async function listDatasets({ userId, q, page = 1, limit = 50, includeData = false }) {
  const filter = { user: toObjectId(userId) };
  const term = typeof q === "string" ? q.trim() : "";
  if (term) filter.name = { $regex: escapeRegex(term), $options: "i" };

  const pipeline = [
    { $match: filter },
    { $sort: { createdAt: -1 } }, // served by the { user: 1, createdAt: -1 } index
    { $skip: (page - 1) * limit },
    { $limit: limit },
  ];
  if (includeData) {
    pipeline.push({ $project: INTERNAL_FIELDS });
  } else {
    // Row arrays are the bulk of every document; the list only needs metadata. Counts are computed
    // server-side for legacy documents so the rows never cross the network.
    pipeline.push(
      { $addFields: { rowCount: rowCountExpr, columnCount: columnCountExpr } },
      { $project: { originalData: 0, ...INTERNAL_FIELDS } }
    );
  }

  const [items, total] = await Promise.all([Dataset.aggregate(pipeline), Dataset.countDocuments(filter)]);
  return { items: items.map(withDefaults), total, page, limit };
}

/** Cached list/search. Returns { json, status } where json is the serialized { items, total, ... }. */
async function listDatasetsCached(params) {
  if (params.includeData) return { json: JSON.stringify(await listDatasets(params)), status: "BYPASS" };
  const { userId, ...query } = params;
  const cacheKey = await cache.userKey(userId, "datasets", cache.hashParams(query));
  return cache.remember(cacheKey, config.cache.ttl.datasetList, () => listDatasets(params));
}

/** Full dataset (rows included) as a JSON string, served straight from Redis on a hit. */
async function getDatasetCached(userId, datasetId) {
  const oid = toObjectId(datasetId);
  if (!oid) throw new NotFoundError("Dataset not found");
  const cacheKey = await cache.userKey(userId, "dataset", datasetId);
  return cache.remember(cacheKey, config.cache.ttl.dataset, async () => {
    // Scoping the query by owner returns 404 for other users' ids (no existence leak, no IDOR).
    const doc = await Dataset.findOne({ _id: oid, user: toObjectId(userId) }, INTERNAL_FIELDS).lean();
    if (!doc) throw new NotFoundError("Dataset not found");
    return withDefaults(doc);
  });
}

/** Lightweight status probe used by the UI while insights are generated in the background. Not cached. */
async function getInsightsStatus(userId, datasetId) {
  const oid = toObjectId(datasetId);
  if (!oid) throw new NotFoundError("Dataset not found");
  const doc = await Dataset.findOne(
    { _id: oid, user: toObjectId(userId) },
    { insights: 1, insightsStatus: 1, insightsUpdatedAt: 1 }
  ).lean();
  if (!doc) throw new NotFoundError("Dataset not found");
  return {
    datasetId,
    insightsStatus: doc.insightsStatus || "ready",
    insights: doc.insights || "",
    insightsUpdatedAt: doc.insightsUpdatedAt || null,
  };
}

/**
 * Marks a dataset's insights as pending under a fresh requestId and publishes `insights.requested`.
 * De-duplicates: a recent pending request is reused, and a conditional update on the previous requestId
 * makes concurrent callers (UI click + n8n sweeper) collapse into one generation.
 */
async function requestInsightsRegeneration({ datasetId, userId, reason = "manual" }) {
  const oid = toObjectId(datasetId);
  if (!oid) throw new NotFoundError("Dataset not found");
  const filter = { _id: oid, ...(userId ? { user: toObjectId(userId) } : {}) };

  const existing = await Dataset.findOne(filter, { insightsStatus: 1, insightsRequestId: 1, updatedAt: 1 }).lean();
  if (!existing) throw new NotFoundError("Dataset not found");

  const staleMs = config.insights.staleAfterMinutes * 60 * 1000;
  const isFreshPending =
    existing.insightsStatus === "pending" && Date.now() - new Date(existing.updatedAt).getTime() < staleMs;
  if (isFreshPending) {
    return { datasetId, insightsStatus: "pending", deduplicated: true };
  }

  const requestId = crypto.randomUUID();
  const updated = await Dataset.findOneAndUpdate(
    { ...filter, insightsRequestId: existing.insightsRequestId ?? null },
    { $set: { insightsStatus: "pending", insightsRequestId: requestId }, $inc: { insightsAttempts: 1 } },
    { returnDocument: "after", projection: { user: 1 } }
  ).lean();
  if (!updated) return { datasetId, insightsStatus: "pending", deduplicated: true };

  const ownerId = String(updated.user);
  await cache.invalidateUser(ownerId);
  eventBus.publishSafe(
    TOPICS.INSIGHTS_REQUESTED,
    buildEnvelope({
      eventId: `insights-requested:${requestId}`,
      type: "insights_requested",
      userId: ownerId,
      source: "api",
      data: { datasetId, requestId, reason },
    })
  );
  return { datasetId, insightsStatus: "pending", deduplicated: false };
}

/** Renames a dataset (metadata only). Returns the list-shaped document (no rows). */
async function renameDataset(userId, datasetId, name) {
  const oid = toObjectId(datasetId);
  if (!oid) throw new NotFoundError("Dataset not found");
  const doc = await Dataset.findOneAndUpdate(
    { _id: oid, user: toObjectId(userId) },
    { $set: { name } },
    { returnDocument: "after", projection: { originalData: 0, ...INTERNAL_FIELDS } }
  ).lean();
  if (!doc) throw new NotFoundError("Dataset not found");
  await cache.invalidateUser(userId);
  return withDefaults(doc);
}

/** Permanently deletes a dataset. Dashboards that reference it render the widget as "dataset removed". */
async function deleteDataset(userId, datasetId) {
  const oid = toObjectId(datasetId);
  if (!oid) throw new NotFoundError("Dataset not found");
  const result = await Dataset.deleteOne({ _id: oid, user: toObjectId(userId) });
  if (!result.deletedCount) throw new NotFoundError("Dataset not found");
  await cache.invalidateUser(userId);
  logger.info({ datasetId }, "Dataset deleted");
}

module.exports = {
  renameDataset,
  deleteDataset,
  createDataset,
  listDatasets,
  listDatasetsCached,
  getDatasetCached,
  getInsightsStatus,
  requestInsightsRegeneration,
  withDefaults,
};

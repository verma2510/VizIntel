/**
 * Activity aggregation (run by the `activity-aggregator` consumer group, or in-process in inline mode).
 *
 * Kafka delivers at-least-once, so the sink must be idempotent. Instead of `$inc` counters (which would
 * double count on every redelivery), this uses a two-step, idempotent-by-construction approach:
 *   1. Upsert raw events keyed by eventId ($setOnInsert) — a redelivered event is a no-op.
 *   2. Recompute the daily rollup for every (user, day) bucket touched by the batch from the raw events
 *      and replace the ActivityMetric document. Recomputing twice yields the same result.
 * A monotonic guard (only replace if the new rollup has >= events) makes concurrent recomputes of the
 * same bucket from different partitions/topics converge on the freshest result.
 */
const ActivityEvent = require("../models/ActivityEvent");
const ActivityMetric = require("../models/ActivityMetric");
const { config } = require("../config/env");
const { toObjectId } = require("../lib/mongoHelpers");

const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_N = 10;
const TYPE_TO_COUNTER = { page_view: "pageViews", click: "clicks", search: "searches", dataset_uploaded: "uploads" };
const TYPE_TO_RANKING = { page_view: "topPages", click: "topClicks", search: "topSearches" };

const toDay = (value) => new Date(value).toISOString().slice(0, 10);
const startOfUtcDay = (value) => new Date(`${toDay(value)}T00:00:00.000Z`);
const bucketOf = (event) => `${event.userId || "anonymous"}|${toDay(event.occurredAt)}`;
const normalizeSearch = (query) => String(query).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 100);

/** The dimension each event type is ranked by: page path, click target, or normalised search term. */
function deriveKey(event) {
  const properties = event.data?.properties || {};
  switch (event.type) {
    case "page_view":
      return String(event.data?.path || "/").slice(0, 200);
    case "click":
      return typeof properties.target === "string" ? properties.target.slice(0, 100) : null;
    case "search":
      return typeof properties.query === "string" ? normalizeSearch(properties.query) : null;
    default:
      return null;
  }
}

function toRawDocument(event) {
  const properties =
    event.type === "dataset_uploaded"
      ? { datasetId: event.data?.datasetId ?? null, rowCount: event.data?.rowCount ?? null }
      : event.data?.properties || {};
  return {
    _id: event.eventId,
    type: event.type,
    user: event.userId ? toObjectId(event.userId) : null,
    anonymousId: event.anonymousId || null,
    sessionId: event.sessionId || null,
    bucket: bucketOf(event),
    day: toDay(event.occurredAt),
    key: deriveKey(event),
    path: event.data?.path || null,
    properties,
    occurredAt: new Date(event.occurredAt),
    createdAt: new Date(),
  };
}

/** Pure function: turns the recompute aggregation output into ActivityMetric documents. */
function buildMetricDocuments(buckets, { counts = [], sessions = [], keys = [] } = {}, now = new Date()) {
  const docs = new Map();
  const ensure = (bucket) => {
    if (!docs.has(bucket)) {
      const separator = bucket.lastIndexOf("|");
      const userPart = bucket.slice(0, separator);
      const day = bucket.slice(separator + 1);
      docs.set(bucket, {
        _id: bucket,
        user: userPart === "anonymous" ? null : toObjectId(userPart),
        day,
        date: new Date(`${day}T00:00:00.000Z`),
        pageViews: 0,
        clicks: 0,
        searches: 0,
        uploads: 0,
        totalEvents: 0,
        uniqueSessions: 0,
        topPages: [],
        topClicks: [],
        topSearches: [],
        firstEventAt: null,
        lastEventAt: null,
        updatedAt: now,
      });
    }
    return docs.get(bucket);
  };

  buckets.forEach(ensure);

  for (const row of counts) {
    const doc = ensure(row._id.bucket);
    const counter = TYPE_TO_COUNTER[row._id.type];
    if (counter) doc[counter] += row.count;
    doc.totalEvents += row.count;
    if (row.first && (!doc.firstEventAt || row.first < doc.firstEventAt)) doc.firstEventAt = row.first;
    if (row.last && (!doc.lastEventAt || row.last > doc.lastEventAt)) doc.lastEventAt = row.last;
  }
  for (const row of sessions) ensure(row._id).uniqueSessions = row.count;
  for (const row of keys) {
    const ranking = TYPE_TO_RANKING[row._id.type];
    if (ranking) ensure(row._id.bucket)[ranking].push({ key: row._id.key, count: row.count });
  }
  for (const doc of docs.values()) {
    for (const ranking of Object.values(TYPE_TO_RANKING)) {
      doc[ranking] = doc[ranking]
        .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
        .slice(0, TOP_N);
    }
  }
  return [...docs.values()];
}

const isOnlyDuplicateKeyErrors = (err) => {
  const writeErrors = err?.writeErrors || [];
  return writeErrors.length > 0 && writeErrors.every((e) => (e.code ?? e.err?.code) === 11000);
};

/** Rebuilds the rollups for the given buckets from raw events. Idempotent. */
async function recomputeBuckets(buckets) {
  if (!buckets.length) return 0;
  const [facets] = await ActivityEvent.aggregate([
    { $match: { bucket: { $in: buckets } } }, // served by { bucket: 1, type: 1 }
    {
      $facet: {
        counts: [
          {
            $group: {
              _id: { bucket: "$bucket", type: "$type" },
              count: { $sum: 1 },
              first: { $min: "$occurredAt" },
              last: { $max: "$occurredAt" },
            },
          },
        ],
        sessions: [
          { $match: { sessionId: { $ne: null } } },
          { $group: { _id: { bucket: "$bucket", sessionId: "$sessionId" } } },
          { $group: { _id: "$_id.bucket", count: { $sum: 1 } } },
        ],
        keys: [
          { $match: { key: { $ne: null } } },
          { $group: { _id: { bucket: "$bucket", type: "$type", key: "$key" }, count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const docs = buildMetricDocuments(buckets, facets);
  try {
    await ActivityMetric.bulkWrite(
      docs.map((doc) => ({
        replaceOne: {
          // Monotonic guard: never replace a rollup computed from MORE raw events (a fresher concurrent read).
          filter: { _id: doc._id, totalEvents: { $lte: doc.totalEvents } },
          replacement: doc,
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (err) {
    // Duplicate-key on upsert == a fresher rollup already exists for that bucket; that's the desired outcome.
    if (!isOnlyDuplicateKeyErrors(err)) throw err;
  }
  return docs.length;
}

/** Consumer entry point: idempotently ingests a batch of activity envelopes. */
async function ingestEvents(events) {
  const cutoff = Date.now() - Math.max(1, config.events.rawRetentionDays - 1) * DAY_MS;
  const unique = new Map();
  for (const event of events) {
    if (!TYPE_TO_COUNTER[event.type]) continue;
    // Raw rows expire after the retention window; recomputing a bucket that old would under-count.
    if (Date.parse(event.occurredAt) < cutoff) continue;
    unique.set(event.eventId, toRawDocument(event));
  }
  if (unique.size === 0) return { inserted: 0, duplicates: 0, buckets: 0 };

  const docs = [...unique.values()];
  const result = await ActivityEvent.bulkWrite(
    docs.map(({ _id, ...doc }) => ({ updateOne: { filter: { _id }, update: { $setOnInsert: doc }, upsert: true } })),
    { ordered: false }
  );

  // Always recompute — even if every event was a duplicate — so a crash between step 1 and step 2 on a
  // previous delivery is repaired on redelivery.
  const buckets = [...new Set(docs.map((doc) => doc.bucket))];
  await recomputeBuckets(buckets);

  const inserted = result.upsertedCount || 0;
  return { inserted, duplicates: docs.length - inserted, buckets: buckets.length };
}

/** Rolls the daily documents up into the "last N days" view shown on the dashboard. */
async function getUserActivitySummary(userId, days = 7) {
  const userOid = toObjectId(userId);
  const to = new Date();
  const from = startOfUtcDay(new Date(to.getTime() - (days - 1) * DAY_MS));
  const empty = { pageViews: 0, clicks: 0, searches: 0, uploads: 0, sessions: 0 };
  if (!userOid) return { days, from, to, totals: empty, series: [], topSearches: [], topPages: [], lastEventAt: null };

  const metrics = await ActivityMetric.find(
    { user: userOid, date: { $gte: from } },
    { _id: 0, day: 1, pageViews: 1, clicks: 1, searches: 1, uploads: 1, uniqueSessions: 1, topSearches: 1, topPages: 1, lastEventAt: 1 }
  )
    .sort({ date: 1 })
    .lean();

  const byDay = new Map(metrics.map((m) => [m.day, m]));
  const totals = { ...empty };
  const series = [];
  const searchCounts = new Map();
  const pageCounts = new Map();
  let lastEventAt = null;

  for (let i = 0; i < days; i++) {
    const day = toDay(new Date(from.getTime() + i * DAY_MS));
    const m = byDay.get(day);
    series.push({
      day,
      pageViews: m?.pageViews || 0,
      clicks: m?.clicks || 0,
      searches: m?.searches || 0,
      uploads: m?.uploads || 0,
    });
    if (!m) continue;
    totals.pageViews += m.pageViews || 0;
    totals.clicks += m.clicks || 0;
    totals.searches += m.searches || 0;
    totals.uploads += m.uploads || 0;
    totals.sessions += m.uniqueSessions || 0;
    for (const { key, count } of m.topSearches || []) searchCounts.set(key, (searchCounts.get(key) || 0) + count);
    for (const { key, count } of m.topPages || []) pageCounts.set(key, (pageCounts.get(key) || 0) + count);
    if (m.lastEventAt && (!lastEventAt || m.lastEventAt > lastEventAt)) lastEventAt = m.lastEventAt;
  }

  const top = (counts) =>
    [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

  return {
    days,
    from,
    to,
    totals,
    series,
    topSearches: top(searchCounts),
    topPages: top(pageCounts),
    lastEventAt,
  };
}

module.exports = {
  ingestEvents,
  recomputeBuckets,
  buildMetricDocuments,
  deriveKey,
  toDay,
  bucketOf,
  getUserActivitySummary,
  startOfUtcDay,
};

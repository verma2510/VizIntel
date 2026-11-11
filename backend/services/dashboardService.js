/**
 * Custom dashboards: CRUD, duplication and public sharing.
 *
 * Every query is scoped by owner, so another user's id yields a 404 (no existence leak, no IDOR).
 * Public reads (share links) only ever expose datasets owned by the dashboard's owner — a widget that
 * points at someone else's dataset id simply renders as "dataset unavailable".
 */
const crypto = require("crypto");
const Dashboard = require("../models/Dashboard");
const Dataset = require("../models/Dataset");
const cache = require("../lib/cache");
const { config } = require("../config/env");
const { NotFoundError } = require("../lib/errors");
const { toObjectId } = require("../lib/mongoHelpers");
const { withDefaults } = require("./datasetService");

const shareCacheKey = (token) => cache.key("share", token);

function serialize(doc) {
  return {
    _id: String(doc._id),
    name: doc.name,
    description: doc.description || "",
    widgets: (doc.widgets || []).map((w) => ({ ...w, datasetId: w.datasetId ? String(w.datasetId) : null })),
    filters: doc.filters || {},
    isShared: Boolean(doc.shareToken),
    shareToken: doc.shareToken || null,
    sharedAt: doc.sharedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const toStoredWidgets = (widgets) =>
  widgets.map((w) => ({ ...w, datasetId: w.datasetId ? toObjectId(w.datasetId) : null }));

function ownedFilter(userId, dashboardId) {
  const oid = toObjectId(dashboardId);
  const userOid = toObjectId(userId);
  if (!oid || !userOid) throw new NotFoundError("Dashboard not found");
  return { _id: oid, user: userOid };
}

async function dropShareCache(doc) {
  if (doc?.shareToken) await cache.del(shareCacheKey(doc.shareToken));
}

async function listDashboards(userId) {
  const userOid = toObjectId(userId);
  if (!userOid) return [];
  const docs = await Dashboard.find({ user: userOid }).sort({ updatedAt: -1 }).limit(200).lean();
  return docs.map(serialize);
}

async function getDashboard(userId, dashboardId) {
  const doc = await Dashboard.findOne(ownedFilter(userId, dashboardId)).lean();
  if (!doc) throw new NotFoundError("Dashboard not found");
  return serialize(doc);
}

async function createDashboard(userId, input) {
  const doc = await Dashboard.create({
    user: toObjectId(userId),
    name: input.name,
    description: input.description,
    widgets: toStoredWidgets(input.widgets),
    filters: input.filters,
  });
  return serialize(doc.toObject());
}

async function updateDashboard(userId, dashboardId, patch) {
  const update = { ...patch };
  if (patch.widgets) update.widgets = toStoredWidgets(patch.widgets);
  const doc = await Dashboard.findOneAndUpdate(ownedFilter(userId, dashboardId), { $set: update }, { returnDocument: "after" }).lean();
  if (!doc) throw new NotFoundError("Dashboard not found");
  await dropShareCache(doc);
  return serialize(doc);
}

async function deleteDashboard(userId, dashboardId) {
  const doc = await Dashboard.findOneAndDelete(ownedFilter(userId, dashboardId), { projection: { shareToken: 1 } }).lean();
  if (!doc) throw new NotFoundError("Dashboard not found");
  await dropShareCache(doc);
}

async function duplicateDashboard(userId, dashboardId) {
  const source = await Dashboard.findOne(ownedFilter(userId, dashboardId)).lean();
  if (!source) throw new NotFoundError("Dashboard not found");
  const doc = await Dashboard.create({
    user: source.user,
    name: `${source.name} (copy)`.slice(0, 120),
    description: source.description,
    widgets: source.widgets,
    filters: source.filters,
  });
  return serialize(doc.toObject());
}

/** Idempotent: an already-shared dashboard keeps its existing link. */
async function enableSharing(userId, dashboardId) {
  const filter = ownedFilter(userId, dashboardId);
  const existing = await Dashboard.findOne(filter, { shareToken: 1 }).lean();
  if (!existing) throw new NotFoundError("Dashboard not found");
  if (existing.shareToken) return getDashboard(userId, dashboardId);

  const shareToken = crypto.randomBytes(18).toString("base64url");
  const doc = await Dashboard.findOneAndUpdate(filter, { $set: { shareToken, sharedAt: new Date() } }, { returnDocument: "after" }).lean();
  return serialize(doc);
}

async function disableSharing(userId, dashboardId) {
  const filter = ownedFilter(userId, dashboardId);
  const before = await Dashboard.findOneAndUpdate(filter, { $unset: { shareToken: "", sharedAt: "" } }, { returnDocument: "before" }).lean();
  if (!before) throw new NotFoundError("Dashboard not found");
  await dropShareCache(before);
  return getDashboard(userId, dashboardId);
}

async function loadSharedDashboard(token) {
  const doc = await Dashboard.findOne({ shareToken: token }).lean();
  if (!doc) throw new NotFoundError("This shared dashboard does not exist or is no longer shared");

  const ids = [...new Set(doc.widgets.map((w) => w.datasetId && String(w.datasetId)).filter(Boolean))].map(toObjectId);
  const datasets = ids.length
    ? await Dataset.find(
        { _id: { $in: ids }, user: doc.user },
        { insightsRequestId: 0, insightsError: 0, insightsAttempts: 0, user: 0 }
      ).lean()
    : [];

  const { shareToken, sharedAt, ...dashboard } = serialize(doc);
  return { dashboard: { ...dashboard, sharedAt }, datasets: datasets.map(withDefaults) };
}

/** Public, read-only view. Cached briefly; edits and revocation drop the cache entry immediately. */
async function getSharedDashboardCached(token) {
  if (typeof token !== "string" || !/^[\w-]{16,64}$/.test(token)) {
    throw new NotFoundError("This shared dashboard does not exist or is no longer shared");
  }
  return cache.remember(shareCacheKey(token), config.cache.ttl.sharedDashboard, () => loadSharedDashboard(token));
}

module.exports = {
  listDashboards,
  getDashboard,
  createDashboard,
  updateDashboard,
  deleteDashboard,
  duplicateDashboard,
  enableSharing,
  disableSharing,
  getSharedDashboardCached,
  serialize,
};

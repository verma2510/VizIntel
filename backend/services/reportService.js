/**
 * Read models consumed by n8n workflows through the internal API.
 */
const Dataset = require("../models/Dataset");
const ActivityMetric = require("../models/ActivityMetric");
const User = require("../models/User");
const { config } = require("../config/env");
const { rowCountExpr } = require("../lib/mongoHelpers");
const { startOfUtcDay } = require("./activityService");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-user activity/upload report for the last `days` days (used by the scheduled n8n report workflow).
 * Three aggregations run in parallel; only users with uploads or activity in the period are included.
 */
async function buildActivityReport({ days = 7 } = {}) {
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);
  const fromDay = startOfUtcDay(from);

  const [uploads, activity, searches] = await Promise.all([
    Dataset.aggregate([
      { $match: { createdAt: { $gte: from } } },
      { $sort: { createdAt: -1 } },
      { $project: { user: 1, name: 1, createdAt: 1, rows: rowCountExpr } },
      {
        $group: {
          _id: "$user",
          datasetsUploaded: { $sum: 1 },
          rowsProcessed: { $sum: "$rows" },
          recent: { $push: { name: "$name", uploadedAt: "$createdAt", rows: "$rows" } },
        },
      },
      { $project: { datasetsUploaded: 1, rowsProcessed: 1, recentDatasets: { $slice: ["$recent", 5] } } },
    ]),
    ActivityMetric.aggregate([
      { $match: { date: { $gte: fromDay }, user: { $ne: null } } },
      {
        $group: {
          _id: "$user",
          pageViews: { $sum: "$pageViews" },
          clicks: { $sum: "$clicks" },
          searches: { $sum: "$searches" },
          activeDays: { $sum: 1 },
        },
      },
    ]),
    ActivityMetric.aggregate([
      { $match: { date: { $gte: fromDay }, user: { $ne: null } } },
      { $unwind: "$topSearches" },
      { $group: { _id: { user: "$user", term: "$topSearches.key" }, count: { $sum: "$topSearches.count" } } },
      { $sort: { count: -1 } },
      { $group: { _id: "$_id.user", terms: { $push: { term: "$_id.term", count: "$count" } } } },
      { $project: { terms: { $slice: ["$terms", 3] } } },
    ]),
  ]);

  const byUser = new Map();
  const entry = (id) => {
    const key = String(id);
    if (!byUser.has(key)) {
      byUser.set(key, {
        userId: key,
        datasetsUploaded: 0,
        rowsProcessed: 0,
        recentDatasets: [],
        activity: { pageViews: 0, clicks: 0, searches: 0, activeDays: 0 },
        topSearches: [],
      });
    }
    return byUser.get(key);
  };
  for (const u of uploads) Object.assign(entry(u._id), { datasetsUploaded: u.datasetsUploaded, rowsProcessed: u.rowsProcessed, recentDatasets: u.recentDatasets });
  for (const a of activity) entry(a._id).activity = { pageViews: a.pageViews, clicks: a.clicks, searches: a.searches, activeDays: a.activeDays };
  for (const s of searches) entry(s._id).topSearches = s.terms;

  const users = await User.find({ _id: { $in: [...byUser.keys()] } }, { name: 1, email: 1 }).lean();
  const usersById = new Map(users.map((u) => [String(u._id), u]));

  const reports = [...byUser.values()]
    .filter((r) => usersById.has(r.userId))
    .map(({ userId, ...rest }) => {
      const user = usersById.get(userId);
      return { user: { id: userId, name: user.name, email: user.email }, ...rest, dashboardUrl: `${config.appUrl}/dashboard` };
    })
    .sort((a, b) => b.datasetsUploaded - a.datasetsUploaded || b.activity.pageViews - a.activity.pageViews);

  const totals = reports.reduce(
    (acc, r) => ({
      users: acc.users + 1,
      datasetsUploaded: acc.datasetsUploaded + r.datasetsUploaded,
      rowsProcessed: acc.rowsProcessed + r.rowsProcessed,
      pageViews: acc.pageViews + r.activity.pageViews,
      clicks: acc.clicks + r.activity.clicks,
      searches: acc.searches + r.activity.searches,
    }),
    { users: 0, datasetsUploaded: 0, rowsProcessed: 0, pageViews: 0, clicks: 0, searches: 0 }
  );

  return { period: { from, to, days }, generatedAt: new Date(), totals, reports };
}

/** Datasets whose insights failed or have been "pending" too long — swept and retried by n8n. */
async function getInsightsBacklog({
  staleMinutes = config.insights.staleAfterMinutes,
  limit = 25,
  maxAttempts = config.insights.maxAttempts,
} = {}) {
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
  const docs = await Dataset.find(
    {
      $or: [{ insightsStatus: "failed" }, { insightsStatus: "pending", updatedAt: { $lt: staleBefore } }],
      // Stop retrying a dataset after maxAttempts (e.g. a permanently invalid API key) — no infinite loops.
      insightsAttempts: { $not: { $gte: maxAttempts } },
    },
    { name: 1, user: 1, insightsStatus: 1, insightsAttempts: 1, updatedAt: 1 }
  )
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  return {
    count: docs.length,
    items: docs.map((d) => ({
      datasetId: String(d._id),
      name: d.name,
      userId: String(d.user),
      insightsStatus: d.insightsStatus,
      attempts: d.insightsAttempts || 0,
      updatedAt: d.updatedAt,
    })),
  };
}

module.exports = { buildActivityReport, getInsightsBacklog };

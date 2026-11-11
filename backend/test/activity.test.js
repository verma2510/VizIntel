process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMetricDocuments, deriveKey, bucketOf, toDay } = require("../services/activityService");

const USER = "507f1f77bcf86cd799439011";

test("bucket = user + UTC day; anonymous events share an anonymous bucket", () => {
  assert.equal(bucketOf({ userId: USER, occurredAt: "2026-03-01T23:59:59.000Z" }), `${USER}|2026-03-01`);
  assert.equal(bucketOf({ userId: null, occurredAt: "2026-03-02T00:00:00.000Z" }), "anonymous|2026-03-02");
  assert.equal(toDay("2026-03-02T05:00:00+05:30"), "2026-03-01");
});

test("deriveKey normalises search terms and extracts click targets / paths", () => {
  assert.equal(deriveKey({ type: "search", data: { properties: { query: "  Q3   Sales " } } }), "q3 sales");
  assert.equal(deriveKey({ type: "click", data: { properties: { target: "dataset_select" } } }), "dataset_select");
  assert.equal(deriveKey({ type: "page_view", data: { path: "/dashboard" } }), "/dashboard");
  assert.equal(deriveKey({ type: "dataset_uploaded", data: {} }), null);
});

test("buildMetricDocuments rolls facets up into per-bucket daily metrics", () => {
  const bucket = `${USER}|2026-03-01`;
  const first = new Date("2026-03-01T08:00:00Z");
  const last = new Date("2026-03-01T18:00:00Z");
  const [doc] = buildMetricDocuments([bucket], {
    counts: [
      { _id: { bucket, type: "page_view" }, count: 5, first, last },
      { _id: { bucket, type: "click" }, count: 3, first, last },
      { _id: { bucket, type: "search" }, count: 2, first, last },
      { _id: { bucket, type: "dataset_uploaded" }, count: 1, first, last },
    ],
    sessions: [{ _id: bucket, count: 2 }],
    keys: [
      { _id: { bucket, type: "search", key: "revenue" }, count: 1 },
      { _id: { bucket, type: "search", key: "sales" }, count: 1 },
      { _id: { bucket, type: "page_view", key: "/dashboard" }, count: 5 },
    ],
  });

  assert.equal(doc._id, bucket);
  assert.equal(String(doc.user), USER);
  assert.equal(doc.day, "2026-03-01");
  assert.deepEqual(
    { pageViews: doc.pageViews, clicks: doc.clicks, searches: doc.searches, uploads: doc.uploads, totalEvents: doc.totalEvents },
    { pageViews: 5, clicks: 3, searches: 2, uploads: 1, totalEvents: 11 }
  );
  assert.equal(doc.uniqueSessions, 2);
  assert.deepEqual(doc.topSearches.map((s) => s.key), ["revenue", "sales"], "ties broken alphabetically");
  assert.deepEqual(doc.topPages, [{ key: "/dashboard", count: 5 }]);
  assert.equal(doc.firstEventAt, first);
  assert.equal(doc.lastEventAt, last);
});

test("rebuilding from the same facets is deterministic (idempotent recompute)", () => {
  const bucket = "anonymous|2026-03-01";
  const facets = { counts: [{ _id: { bucket, type: "page_view" }, count: 4 }], sessions: [], keys: [] };
  const now = new Date("2026-03-01T00:00:00Z");
  assert.deepEqual(buildMetricDocuments([bucket], facets, now), buildMetricDocuments([bucket], facets, now));
  assert.equal(buildMetricDocuments([bucket], facets, now)[0].user, null);
});

test("touched buckets with no remaining events produce zeroed documents", () => {
  const [doc] = buildMetricDocuments([`${USER}|2026-03-05`], {});
  assert.equal(doc.totalEvents, 0);
  assert.deepEqual(doc.topClicks, []);
});

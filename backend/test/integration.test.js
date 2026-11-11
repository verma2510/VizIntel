/**
 * End-to-end API test in inline mode (no Kafka/Redis needed) against a throwaway MongoDB database.
 * Skipped unless TEST_MONGO_URI is set, e.g.:
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27017 INSIGHTS_MODE=async npm test
 * The LLM endpoint is pointed at an unroutable port, so the fallback/failure paths are exercised.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");

const BASE_MONGO = process.env.TEST_MONGO_URI;

test("full API flow (inline event transport)", { skip: !BASE_MONGO && "TEST_MONGO_URI not set" }, async (t) => {
  // --- Fake n8n: captures webhooks and verifies their HMAC signatures --------------------------------
  const webhookSecret = "integration-secret";
  const webhooks = [];
  const n8n = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const ts = req.headers["x-vizintel-timestamp"];
      const expected = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(`${ts}.${body}`).digest("hex");
      webhooks.push({ path: req.url, body: JSON.parse(body), validSignature: req.headers["x-vizintel-signature"] === expected });
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    });
  });
  await new Promise((resolve) => n8n.listen(0, "127.0.0.1", resolve));
  const n8nUrl = `http://127.0.0.1:${n8n.address().port}`;

  // --- Environment (must be set before any app module is required) -----------------------------------
  const dbName = `vizintel_it_${Date.now()}`;
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGO_URI: `${BASE_MONGO.replace(/\/$/, "")}/${dbName}`,
    JWT_SECRET: "integration-jwt-secret",
    KAFKA_ENABLED: "false",
    REDIS_ENABLED: process.env.TEST_REDIS_URL ? "true" : "false",
    REDIS_URL: process.env.TEST_REDIS_URL || "",
    REDIS_KEY_PREFIX: `vizintel:it:${Date.now()}:`,
    AI_API_KEY: "invalid",
    AI_API_URL: "http://127.0.0.1:9/unreachable",
    AI_TIMEOUT_MS: "2000",
    INSIGHTS_MODE: process.env.INSIGHTS_MODE || "sync",
    INTERNAL_API_KEY: "internal-test-key",
    N8N_WEBHOOK_SECRET: webhookSecret,
    N8N_WEBHOOK_DATASET_UPLOADED: `${n8nUrl}/dataset-uploaded`,
    N8N_WEBHOOK_INSIGHTS_GENERATED: `${n8nUrl}/insights-generated`,
    EVENTS_FLUSH_INTERVAL_MS: "20",
  });

  const mongoose = require("mongoose");
  const connectDB = require("../config/db");
  const { createApp } = require("../app");
  const eventBus = require("../lib/eventBus");
  const { getRedis, closeRedis } = require("../lib/redis");
  const { SUBSCRIPTIONS } = require("../events/registry");
  const { config } = require("../config/env");

  await connectDB({ exitOnFailure: false });
  getRedis();
  eventBus.registerSubscriptions(SUBSCRIPTIONS);
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await eventBus.shutdown();
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await closeRedis();
    server.close();
    n8n.close();
  });

  const call = async (path, { token, method = "GET", json, body, headers = {} } = {}) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: json ? JSON.stringify(json) : body,
    });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, data };
  };
  const waitFor = async (fn, label, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await fn();
      if (last) return last;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out waiting for: ${label}`);
  };

  // --- Health -----------------------------------------------------------------------------------------
  const health = await call("/health");
  assert.equal(health.status, 200);
  assert.equal(health.data, "Server is awake and running", "UptimeRobot probe response must not change");
  assert.equal((await call("/health/ready")).data.kafka.mode, "inline");

  // --- Auth (unchanged behaviour) ---------------------------------------------------------------------
  const register = await call("/api/auth/register", {
    method: "POST",
    json: { name: "Integration User", email: `it-${Date.now()}@example.test`, password: "secret123" },
  });
  assert.equal(register.status, 200);
  const token = register.data.token;
  assert.ok(token);

  // --- Upload -----------------------------------------------------------------------------------------
  const csv = ["OrderID,Region,Amount,Quantity,Date", "ORD-1,North,120.5,3,2026-01-01", "ORD-2,South,80,1,2026-01-02", "ORD-3,North,200,5,2026-01-03"].join("\n");
  const form = new FormData();
  form.append("file", new File([csv], "q1-sales.csv", { type: "text/csv" }));
  const upload = await call("/api/datasets/upload", { token, method: "POST", body: form });
  assert.equal(upload.status, 200, JSON.stringify(upload.data));
  const dataset = upload.data;
  assert.equal(dataset.rowCount, 3);
  assert.equal(dataset.originalData.length, 3, "upload response still contains rows");
  assert.ok(dataset.kpis.Amount, "heuristic classification still yields a currency KPI");
  assert.ok(dataset.charts.length > 0);
  assert.equal(dataset.insightsRequestId, undefined, "internal fields are not exposed");
  if (config.insights.mode === "sync") {
    assert.equal(dataset.insightsStatus, "failed", "LLM unreachable -> failed status + fallback text");
    assert.match(dataset.insights, /Failed to generate AI insights/);
  } else {
    assert.equal(dataset.insightsStatus, "pending");
    const resolved = await waitFor(async () => {
      const r = await call(`/api/datasets/${dataset._id}/insights`, { token });
      return r.data.insightsStatus !== "pending" && r.data;
    }, "async insight generation");
    assert.equal(resolved.insightsStatus, "failed");
  }

  const badType = new FormData();
  badType.append("file", new File(["x"], "notes.txt", { type: "text/plain" }));
  const rejected = await call("/api/datasets/upload", { token, method: "POST", body: badType });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.msg, "Please upload an Excel or CSV file");

  // --- List / search / detail -------------------------------------------------------------------------
  const list = await call("/api/datasets", { token });
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.data), "list body is still an array");
  assert.equal(list.headers.get("x-total-count"), "1");
  assert.equal(list.data[0].originalData, undefined, "list omits row arrays");
  assert.equal(list.data[0].rowCount, 3);

  assert.equal((await call("/api/datasets?q=Q1-S", { token })).data.length, 1, "case-insensitive search");
  assert.equal((await call("/api/datasets?q=(.*)", { token })).data.length, 0, "regex input is escaped");
  assert.equal((await call("/api/datasets?limit=500", { token })).status, 400, "query validation");

  const detail = await call(`/api/datasets/${dataset._id}`, { token });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.originalData.length, 3);
  assert.equal((await call(`/api/datasets/${new mongoose.Types.ObjectId()}`, { token })).status, 404);
  assert.equal((await call(`/api/datasets/not-an-id`, { token })).status, 404);

  // --- Analytics (aggregation rewrite keeps the response shape) ---------------------------------------
  const summary = await call("/api/analytics/summary", { token });
  assert.deepEqual(
    { totalDatasets: summary.data.totalDatasets, totalRowsProcessed: summary.data.totalRowsProcessed },
    { totalDatasets: 1, totalRowsProcessed: 3 }
  );
  assert.equal(summary.data.recentDatasets[0].name, "q1-sales.csv");
  const analytics = await call(`/api/analytics/${dataset._id}`, { token });
  assert.equal(analytics.data.summary.totalRows, 3);
  assert.equal(analytics.data.summary.totalColumns, 5);
  assert.equal((await call(`/api/analytics/${new mongoose.Types.ObjectId()}`, { token })).data.msg, "Dataset not found or unauthorized");

  // --- Event ingestion -> aggregation ------------------------------------------------------------------
  const sessionId = "it-session";
  const events = [
    { eventId: crypto.randomUUID(), type: "page_view", path: "/dashboard", sessionId },
    { eventId: crypto.randomUUID(), type: "click", sessionId, properties: { target: "dataset_select" } },
    { eventId: crypto.randomUUID(), type: "search", sessionId, properties: { query: "Q1 Sales", resultCount: 1 } },
    { type: "search", properties: {} }, // invalid: no query
  ];
  const ingest = await call("/api/events", { token, method: "POST", json: { events } });
  assert.equal(ingest.status, 202);
  assert.equal(ingest.data.accepted, 3);
  assert.equal(ingest.data.rejected, 1);

  const activity = await waitFor(async () => {
    const r = await call("/api/activity/summary?days=7", { token });
    const totals = r.data.totals;
    return totals && totals.pageViews === 1 && totals.clicks === 1 && totals.searches === 1 && totals.uploads >= 1 && r.data;
  }, "activity aggregation");
  assert.equal(activity.topSearches[0].key, "q1 sales");

  // Redelivery of the same eventIds must not double count (idempotent consumer).
  await call("/api/events", { token, method: "POST", json: { events: events.slice(0, 3) } });
  await new Promise((r) => setTimeout(r, 600));
  const ActivityMetric = require("../models/ActivityMetric");
  const metric = await ActivityMetric.findOne({ user: new mongoose.Types.ObjectId(register.data.user.id) }).lean();
  assert.deepEqual({ pageViews: metric.pageViews, clicks: metric.clicks, searches: metric.searches }, { pageViews: 1, clicks: 1, searches: 1 });

  // Anonymous events are accepted (e.g. on the login page) and an invalid token never 401s.
  const anonymous = await call("/api/events", {
    method: "POST",
    headers: { Authorization: "Bearer garbage" },
    json: { events: [{ type: "page_view", path: "/login", sessionId: "anon" }] },
  });
  assert.equal(anonymous.status, 202);
  assert.equal((await call("/api/events", { method: "POST", json: { nope: true } })).status, 400);

  // --- n8n notification (dataset.uploaded) ------------------------------------------------------------
  const uploadedHook = await waitFor(() => webhooks.find((w) => w.path === "/dataset-uploaded"), "dataset-uploaded webhook");
  assert.equal(uploadedHook.validSignature, true);
  assert.equal(uploadedHook.body.dataset.id, String(dataset._id));
  assert.equal(uploadedHook.body.user.email, register.data.user.email);
  assert.equal(uploadedHook.body.actions.regenerateInsights, config.insights.mode === "sync");

  // --- Internal API for n8n ---------------------------------------------------------------------------
  assert.equal((await call("/api/internal/insights/backlog")).status, 401);
  const internal = { "X-Internal-Api-Key": "internal-test-key" };
  const backlog = await call("/api/internal/insights/backlog", { headers: internal });
  assert.equal(backlog.status, 200);
  assert.ok(backlog.data.items.some((i) => i.datasetId === String(dataset._id)), "failed insights appear in the backlog");

  const regen = await call(`/api/internal/datasets/${dataset._id}/insights`, { method: "POST", headers: internal, json: { reason: "it" } });
  assert.equal(regen.status, 202);
  assert.equal(regen.data.insightsStatus, "pending");
  const dup = await call(`/api/internal/datasets/${dataset._id}/insights`, { method: "POST", headers: internal, json: {} });
  assert.equal(dup.data.deduplicated, true, "concurrent regeneration requests collapse into one");

  const generatedHook = await waitFor(() => webhooks.find((w) => w.path === "/insights-generated" && w.body.insights.requestId), "insights-generated webhook");
  assert.equal(generatedHook.validSignature, true);
  assert.equal(generatedHook.body.insights.status, "failed");

  const report = await call("/api/internal/reports/activity?days=7", { headers: internal });
  assert.equal(report.status, 200);
  const mine = report.data.reports.find((r) => r.user.email === register.data.user.email);
  assert.equal(mine.datasetsUploaded, 1);
  assert.equal(mine.activity.searches, 1);

  // No duplicate notifications were sent for the same event.
  const uploadHooks = webhooks.filter((w) => w.path === "/dataset-uploaded");
  assert.equal(new Set(uploadHooks.map((w) => w.body.eventId)).size, uploadHooks.length);
});

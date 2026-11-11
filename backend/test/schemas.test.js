process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { clientEventSchema, clientBatchSchema, envelopeSchema, fromClientEvent, normalizeOccurredAt, buildEnvelope } = require("../events/schemas");

test("accepts a well-formed page_view and applies defaults", () => {
  const parsed = clientEventSchema.parse({ type: "page_view", path: "/dashboard", eventId: crypto.randomUUID() });
  assert.deepEqual(parsed.properties, {});
});

test("search events require a non-empty query", () => {
  assert.equal(clientEventSchema.safeParse({ type: "search", properties: {} }).success, false);
  assert.equal(clientEventSchema.safeParse({ type: "search", properties: { query: "   " } }).success, false);
  assert.equal(clientEventSchema.safeParse({ type: "search", properties: { query: "sales" } }).success, true);
});

test("click events require a target", () => {
  assert.equal(clientEventSchema.safeParse({ type: "click", properties: { foo: "bar" } }).success, false);
  assert.equal(clientEventSchema.safeParse({ type: "click", properties: { target: "upload" } }).success, true);
});

test("rejects unknown types, oversized values and too many properties", () => {
  assert.equal(clientEventSchema.safeParse({ type: "purchase" }).success, false);
  assert.equal(clientEventSchema.safeParse({ type: "click", properties: { target: "x".repeat(501) } }).success, false);
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
  assert.equal(clientEventSchema.safeParse({ type: "click", properties: { ...many, target: "t" } }).success, false);
  assert.equal(clientEventSchema.safeParse({ type: "click", properties: { target: "t", nested: { a: 1 } } }).success, false);
});

test("batch schema bounds the number of events", () => {
  assert.equal(clientBatchSchema.safeParse({ events: [] }).success, false);
  assert.equal(clientBatchSchema.safeParse({ events: Array(51).fill({}) }).success, false);
  assert.equal(clientBatchSchema.safeParse({ events: [{}] }).success, true);
});

test("client clocks are clamped to the server receive time when skewed", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");
  assert.equal(normalizeOccurredAt("2026-01-10T11:59:00.000Z", now), "2026-01-10T11:59:00.000Z");
  assert.equal(normalizeOccurredAt("2027-01-01T00:00:00.000Z", now), now.toISOString()); // future
  assert.equal(normalizeOccurredAt("2025-01-01T00:00:00.000Z", now), now.toISOString()); // too old
  assert.equal(normalizeOccurredAt("not-a-date", now), now.toISOString());
});

test("fromClientEvent produces a valid envelope and attributes identity server-side", () => {
  const eventId = crypto.randomUUID();
  const client = clientEventSchema.parse({ eventId, type: "click", sessionId: "s1", properties: { target: "upload" } });

  const authed = fromClientEvent(client, { userId: "507f1f77bcf86cd799439011", userAgent: "UA" });
  assert.equal(envelopeSchema.safeParse(authed).success, true);
  assert.equal(authed.eventId, eventId, "client eventId is preserved for downstream de-duplication");
  assert.equal(authed.userId, "507f1f77bcf86cd799439011");
  assert.equal(authed.anonymousId, null);
  assert.equal(authed.source, "web");

  const anonymous = fromClientEvent(client, { userId: null });
  assert.equal(anonymous.userId, null);
  assert.equal(anonymous.anonymousId, "s1");
});

test("buildEnvelope honours deterministic ids for derived events", () => {
  const a = buildEnvelope({ type: "insights_generated", eventId: "insights-generated:abc-123" });
  assert.equal(a.eventId, "insights-generated:abc-123");
  assert.equal(envelopeSchema.safeParse(a).success, true);
});

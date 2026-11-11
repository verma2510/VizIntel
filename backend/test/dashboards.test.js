process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createDashboardSchema, updateDashboardSchema, MAX_WIDGETS } = require("../validators/dashboardSchemas");

const widget = (overrides = {}) => ({ id: "w1", kind: "chart", datasetId: "65f000000000000000000001", spec: { type: "bar" }, ...overrides });

test("create applies defaults and accepts a valid widget", () => {
  const parsed = createDashboardSchema.parse({ name: "  Sales  ", widgets: [widget()] });
  assert.equal(parsed.name, "Sales");
  assert.equal(parsed.description, "");
  assert.deepEqual(parsed.filters, {});
  assert.equal(parsed.widgets[0].w, 6);
  assert.equal(parsed.widgets[0].h, 4);
  assert.equal(parsed.widgets[0].title, "");
});

test("create rejects a blank name, unknown widget kinds and malformed dataset ids", () => {
  assert.equal(createDashboardSchema.safeParse({ name: "   " }).success, false);
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget({ kind: "iframe" })] }).success, false);
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget({ datasetId: "not-an-id" })] }).success, false);
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget({ datasetId: null, kind: "text" })] }).success, true);
});

test("widget layout is bounded to the 12-column grid", () => {
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget({ w: 13 })] }).success, false);
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget({ h: 1 })] }).success, false);
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget({ w: 12, h: 10 })] }).success, true);
});

test("widget ids must be unique and the widget count is capped", () => {
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget(), widget()] }).success, false);
  const many = Array.from({ length: MAX_WIDGETS + 1 }, (_, i) => widget({ id: `w${i}` }));
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: many }).success, false);
});

test("oversized specs are rejected (a widget can't smuggle a dataset)", () => {
  const spec = { note: "x".repeat(17 * 1024) };
  assert.equal(createDashboardSchema.safeParse({ name: "x", widgets: [widget({ spec })] }).success, false);
});

test("update keeps omitted fields omitted and rejects empty patches", () => {
  const parsed = updateDashboardSchema.parse({ name: "Renamed" });
  assert.deepEqual(Object.keys(parsed), ["name"]);
  assert.equal(updateDashboardSchema.safeParse({}).success, false);
});

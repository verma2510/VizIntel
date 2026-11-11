process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeSuggestion, profileColumns } = require("../services/aiChartService");

const columns = [
  { name: "Order Date", type: "date", semanticType: "date" },
  { name: "Region", type: "categorical", semanticType: "category" },
  { name: "Revenue", type: "numeric", semanticType: "currency" },
  { name: "Units", type: "numeric", semanticType: "quantity" },
  { name: "Order ID", type: "numeric", semanticType: "identifier" },
];

test("keeps a valid suggestion and canonicalises column names", () => {
  const out = sanitizeSuggestion(
    { answer: "Revenue by region.", chart: { type: "bar", x: "region", y: ["REVENUE"], agg: "sum", sort: "desc", limit: 5 }, followUps: ["Which month?"] },
    columns
  );
  assert.deepEqual(out.chart, { type: "bar", title: "", x: "Region", y: ["Revenue"], agg: "sum", sort: "desc", limit: 5 });
  assert.deepEqual(out.followUps, ["Which month?"]);
});

test("drops unknown columns, identifiers as measures, and unknown chart types", () => {
  const out = sanitizeSuggestion({ chart: { type: "bar", x: "Region", y: ["Profit", "Order ID"], agg: "sum" } }, columns);
  assert.deepEqual(out.chart.y, []);
  assert.equal(out.chart.agg, "count"); // no usable metric -> row count
  assert.equal(sanitizeSuggestion({ chart: { type: "sankey", x: "Region" } }, columns).chart, null);
  assert.equal(sanitizeSuggestion({ chart: { type: "line", x: "Nope", y: ["Revenue"] } }, columns).chart, null);
});

test("date axes get a bucket; scatter needs numeric axes; histogram accepts x as the metric", () => {
  const line = sanitizeSuggestion({ chart: { type: "line", x: "Order Date", y: ["Revenue"], bucket: "fortnight" } }, columns).chart;
  assert.equal(line.bucket, "auto");
  assert.equal(sanitizeSuggestion({ chart: { type: "scatter", x: "Region", y: ["Revenue"] } }, columns).chart, null);
  assert.ok(sanitizeSuggestion({ chart: { type: "scatter", x: "Units", y: ["Revenue"] } }, columns).chart);
  assert.deepEqual(sanitizeSuggestion({ chart: { type: "histogram", x: "Revenue" } }, columns).chart.y, ["Revenue"]);
});

test("handles garbage model output without throwing", () => {
  assert.deepEqual(sanitizeSuggestion(null, columns), { answer: "", chart: null, followUps: [] });
  assert.deepEqual(sanitizeSuggestion("text", columns), { answer: "", chart: null, followUps: [] });
});

test("profiles columns from a row sample", () => {
  const rows = [
    { "Order Date": "2026-01-02", Region: "North", Revenue: 10, Units: 1 },
    { "Order Date": "2026-03-04", Region: "South", Revenue: 30, Units: 2 },
    { "Order Date": "2026-02-01", Region: "North", Revenue: 20, Units: 3 },
  ];
  const [date, region, revenue] = profileColumns(columns, rows);
  assert.equal(date.from, "2026-01-02");
  assert.equal(date.to, "2026-03-04");
  assert.deepEqual(region.topValues, ["North", "South"]);
  assert.equal(revenue.min, 10);
  assert.equal(revenue.max, 30);
});

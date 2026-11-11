/**
 * "Ask your data": turns a natural-language question into a short answer plus a chart specification.
 *
 * The LLM (Groq, same configuration as insight generation) only ever sees the dataset's column metadata,
 * a compact profile and the precomputed KPIs — never the full rows. It proposes a chart *spec*; the
 * frontend computes the chart from the real rows, so every plotted number is exact. The model output is
 * untrusted: sanitizeSuggestion() keeps only known chart types/aggregations and existing column names.
 */
const axios = require("axios");
const Dataset = require("../models/Dataset");
const { config } = require("../config/env");
const { NotFoundError, ServiceUnavailableError } = require("../lib/errors");
const { toObjectId } = require("../lib/mongoHelpers");
const logger = require("../lib/logger").child({ component: "aiChartService" });

const CHART_TYPES = ["bar", "hbar", "line", "area", "pie", "doughnut", "polarArea", "radar", "scatter", "bubble", "histogram"];
const AGGREGATIONS = ["sum", "avg", "count", "min", "max", "median", "distinct"];
const BUCKETS = ["auto", "day", "week", "month", "quarter", "year"];
const SORTS = ["none", "asc", "desc", "label"];
const PROFILE_ROWS = 2000;
const TOP_VALUES = 8;

const isPresent = (v) => v !== null && v !== undefined && v !== "";

/** Compact per-column profile (ranges, cardinality, top values) built from a bounded row sample. */
function profileColumns(columns, rows) {
  return columns.map((c) => {
    const values = rows.map((r) => r[c.name]).filter(isPresent);
    const base = { name: c.name, type: c.type, semanticType: c.semanticType, label: c.label };
    if (c.type === "numeric") {
      const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
      if (!nums.length) return base;
      return { ...base, min: Math.min(...nums), max: Math.max(...nums) };
    }
    if (c.type === "date") {
      const times = values.map((v) => Date.parse(v)).filter(Number.isFinite);
      if (!times.length) return base;
      return {
        ...base,
        from: new Date(Math.min(...times)).toISOString().slice(0, 10),
        to: new Date(Math.max(...times)).toISOString().slice(0, 10),
      };
    }
    const counts = new Map();
    for (const v of values) counts.set(String(v), (counts.get(String(v)) || 0) + 1);
    const topValues = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_VALUES).map(([v]) => v.slice(0, 60));
    return { ...base, distinctInSample: counts.size, topValues };
  });
}

const buildPrompt = ({ question, name, profile, kpis }) => `
You are the analytics assistant inside VizIntel, a self-service BI tool. A user is asking about the dataset "${name}".

Answer with ONE JSON object of this exact shape and nothing else:
{
  "answer": "<2-3 sentences: what the chart will show and how to read it>",
  "chart": {
    "type": "<one of: ${CHART_TYPES.join(", ")}>",
    "title": "<short chart title>",
    "x": "<column name: the category/date axis; for scatter/bubble a numeric column>",
    "y": ["<numeric column name>", "..."],
    "agg": "<one of: ${AGGREGATIONS.join(", ")}>",
    "groupBy": "<optional category column to split into series>",
    "bucket": "<for date x only, one of: ${BUCKETS.join(", ")}>",
    "sort": "<one of: ${SORTS.join(", ")}>",
    "limit": <optional integer, top N categories>,
    "size": "<bubble only: numeric column for bubble size>"
  } | null,
  "followUps": ["<up to 3 short follow-up questions>"]
}

RULES:
- Use ONLY column names that appear in COLUMNS, spelled exactly.
- Never invent numbers. You may quote a number only if it appears verbatim in KPIS. The app computes the chart from the full data.
- Change over time -> line or area with a date column as x. Share of a whole (<= 6 parts) -> doughnut or pie. Ranking or comparison -> bar (hbar for long labels) sorted desc. Relationship between two numeric columns -> scatter. Distribution of one numeric column -> histogram (put it in "y").
- "count" counts rows and needs no y column.
- If the question cannot be answered with a chart from these columns, set "chart" to null and explain why in "answer".

COLUMNS:
${JSON.stringify(profile)}

KPIS (column totals computed over all rows):
${JSON.stringify(kpis || {})}

QUESTION:
${question}
`;

/** Validates untrusted model output against the dataset's real columns. Pure; exported for tests. */
function sanitizeSuggestion(raw, columns) {
  const byLower = new Map(columns.map((c) => [String(c.name).toLowerCase(), c]));
  const col = (name) => (typeof name === "string" ? byLower.get(name.trim().toLowerCase()) : undefined);
  const isMeasure = (c) => Boolean(c) && c.type === "numeric" && c.semanticType !== "identifier";

  const answer = typeof raw?.answer === "string" ? raw.answer.trim().slice(0, 800) : "";
  const followUps = Array.isArray(raw?.followUps)
    ? raw.followUps.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().slice(0, 140)).slice(0, 3)
    : [];

  const c = raw?.chart;
  let chart = null;
  if (c && typeof c === "object" && CHART_TYPES.includes(c.type)) {
    const x = col(c.x);
    const yInput = Array.isArray(c.y) ? c.y : c.y ? [c.y] : [];
    let y = [...new Set(yInput.map(col).filter(isMeasure).map((m) => m.name))].slice(0, 6);
    const groupBy = col(c.groupBy);
    const size = col(c.size);
    let agg = AGGREGATIONS.includes(c.agg) ? c.agg : y.length ? "sum" : "count";
    if (!y.length && agg !== "count") agg = "count";
    if (c.type === "histogram" && !y.length && isMeasure(x)) y = [x.name];

    const spec = {
      type: c.type,
      title: typeof c.title === "string" ? c.title.trim().slice(0, 120) : "",
      x: x?.name,
      y,
      agg,
      ...(groupBy && groupBy.name !== x?.name ? { groupBy: groupBy.name } : {}),
      ...(x?.type === "date" ? { bucket: BUCKETS.includes(c.bucket) ? c.bucket : "auto" } : {}),
      sort: SORTS.includes(c.sort) ? c.sort : "none",
      ...(Number.isInteger(c.limit) && c.limit > 0 ? { limit: Math.min(c.limit, 50) } : {}),
      ...(c.type === "bubble" && isMeasure(size) ? { size: size.name } : {}),
    };

    const valid =
      c.type === "histogram"
        ? y.length > 0
        : c.type === "scatter" || c.type === "bubble"
          ? isMeasure(x) && y.length > 0 && (c.type === "scatter" || Boolean(spec.size))
          : Boolean(x);
    if (valid) chart = spec;
  }
  return { answer, chart, followUps };
}

async function askDataset({ userId, datasetId, question }) {
  const oid = toObjectId(datasetId);
  if (!oid) throw new NotFoundError("Dataset not found");
  if (!config.ai.apiKey) throw new ServiceUnavailableError("The AI assistant is not configured on this server (AI_API_KEY missing).");

  const dataset = await Dataset.findOne(
    { _id: oid, user: toObjectId(userId) },
    { name: 1, columns: 1, kpis: 1, originalData: { $slice: PROFILE_ROWS } }
  ).lean();
  if (!dataset) throw new NotFoundError("Dataset not found");
  const columns = dataset.columns || [];
  const profile = profileColumns(columns, dataset.originalData || []);

  let content;
  try {
    const response = await axios.post(
      config.ai.url,
      {
        model: config.ai.model,
        messages: [{ role: "user", content: buildPrompt({ question, name: dataset.name, profile, kpis: dataset.kpis }) }],
        temperature: 0.2,
        response_format: { type: "json_object" },
      },
      {
        headers: { Authorization: `Bearer ${config.ai.apiKey}`, "Content-Type": "application/json" },
        timeout: config.ai.timeoutMs,
      }
    );
    content = response.data?.choices?.[0]?.message?.content;
  } catch (err) {
    logger.warn({ err: err.response?.status || err.message, datasetId }, "Ask-your-data LLM call failed");
    throw new ServiceUnavailableError("The AI service did not respond. Please try again in a moment.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ServiceUnavailableError("The AI returned an unreadable answer. Try rephrasing your question.");
  }
  return { question, ...sanitizeSuggestion(parsed, columns) };
}

module.exports = { askDataset, sanitizeSuggestion, profileColumns, CHART_TYPES, AGGREGATIONS };

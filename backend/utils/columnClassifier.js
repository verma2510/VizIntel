const axios = require("axios");
const { config } = require("../config/env");
const logger = require("../lib/logger").child({ component: "columnClassifier" });

// How many sample values per column to show the LLM (enough to infer meaning, small enough to keep the prompt cheap).
const SAMPLES_PER_COLUMN = 5;

const VALID_SEMANTIC_TYPES = [
  "currency",
  "quantity",
  "percentage",
  "date",
  "identifier",
  "category",
  "text",
];

const buildSampleValues = (data, columnName) => {
  const values = [];
  for (const row of data) {
    const val = row[columnName];
    if (val !== null && val !== undefined && val !== "") {
      values.push(val instanceof Date ? val.toISOString() : val);
    }
    if (values.length >= SAMPLES_PER_COLUMN) break;
  }
  return values;
};

// Local fallback if the LLM call fails or returns something unusable — keeps upload working offline.
const heuristicClassify = (column) => {
  if (column.type === "date") return { semanticType: "date", label: column.name };
  if (column.type === "numeric") {
    const name = column.name.toLowerCase();
    if (/amount|price|cost|revenue|sales|total|value/.test(name)) {
      return { semanticType: "currency", label: column.name };
    }
    if (/percent|rate|%/.test(name)) {
      return { semanticType: "percentage", label: column.name };
    }
    return { semanticType: "quantity", label: column.name };
  }
  if (/id$|^id|code$/i.test(column.name)) {
    return { semanticType: "identifier", label: column.name };
  }
  return { semanticType: "category", label: column.name };
};

/**
 * Uses the LLM to determine the real-world business meaning of each column
 * (currency vs quantity vs date vs identifier, etc.) instead of relying only
 * on generic numeric/categorical typing.
 *
 * Returns { columns, source } where source is "llm" or "heuristic" — callers use it to decide whether
 * the result is worth caching (only genuine LLM classifications are cached).
 */
const classifyColumnsDetailed = async (columns, data) => {
  const fallback = columns.map(heuristicClassify);

  try {
    const columnPreview = columns.map(col => ({
      name: col.name,
      detectedType: col.type,
      sampleValues: buildSampleValues(data, col.name),
    }));

    const prompt = `
      You are a data analyst. For each column below, determine its real-world business meaning.

      Allowed semanticType values ONLY: ${VALID_SEMANTIC_TYPES.join(", ")}.
      - "currency": monetary amounts (revenue, price, cost, amount, sales)
      - "quantity": counts or units (quantity, units sold, headcount)
      - "percentage": rates or percentages
      - "date": dates or timestamps
      - "identifier": IDs, codes, SKUs, order numbers (not meaningful for aggregation)
      - "category": descriptive groupings (product, region, status, department)
      - "text": free-form text not useful for grouping (comments, descriptions)

      Return ONLY a JSON object of this exact shape, no extra text:
      { "columns": [ { "name": "<column name>", "semanticType": "<one of the allowed values>", "label": "<short human-friendly label>" } ] }

      COLUMNS:
      ${JSON.stringify(columnPreview)}
    `;

    const response = await axios.post(
      config.ai.url,
      {
        model: config.ai.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${config.ai.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const parsed = JSON.parse(response.data.choices[0].message.content);
    const byName = new Map(parsed.columns.map(c => [c.name, c]));

    const classified = columns.map((col, idx) => {
      const match = byName.get(col.name);
      if (match && VALID_SEMANTIC_TYPES.includes(match.semanticType)) {
        return { semanticType: match.semanticType, label: match.label || col.name };
      }
      return fallback[idx];
    });
    return { columns: classified, source: "llm" };
  } catch (error) {
    logger.error({ err: error.response?.data || error.message }, "Column Classification Error");
    return { columns: fallback, source: "heuristic" };
  }
};

/** Original API (array of { semanticType, label }), kept for backwards compatibility. */
const classifyColumns = async (columns, data) => (await classifyColumnsDetailed(columns, data)).columns;

module.exports = { classifyColumns, classifyColumnsDetailed, VALID_SEMANTIC_TYPES };

const axios = require("axios");
const { config } = require("../config/env");
const logger = require("../lib/logger").child({ component: "aiInsights" });

const INSIGHTS_FALLBACK_MESSAGE = "Failed to generate AI insights. Please check your AI_API_KEY or connection.";

const buildPrompt = (kpis, columns) => `
      You are an expert business intelligence analyst.

      Analyze the provided KPIs and dataset statistics and generate concise, high-impact business insights.

      STRICT RULES:
      - Do NOT describe the dataset structure.
      - Identify the values
      - Do NOT ASK ANY QUESTIONS.

      CRITICAL: Do NOT use verbs like "identify", "determine", "analyze", or "evaluate".
      State the actual finding directly with the column name and value (e.g., "Google Ads drives 42% of conversions with the lowest CPA of $12").

      Your insights must be BUSINESS-ORIENTED and DATA-DRIVEN.

      Focus on:
      • performance drivers
      • strongest and weakest segments
      • revenue concentration
      • efficiency indicators
      • unusual patterns

      OUTPUT FORMAT:
      Return EXACTLY 6 bullet points.

      Each bullet must:
      - be ONE sentence
      - contain a numeric metric when possible
      - clearly explain the business implication.

      DATA:
      KPIs:
      ${JSON.stringify(kpis)}

      COLUMN_INFO:
      ${JSON.stringify(columns)}
    `;

/**
 * Calls the LLM and THROWS on failure (network error, timeout, non-2xx, empty completion).
 * Used by the insights service/worker, which records the failure and lets retries/n8n handle it.
 */
const generateInsightsStrict = async (kpis, columns) => {
  const response = await axios.post(
    config.ai.url,
    {
      model: config.ai.model,
      messages: [{ role: "user", content: buildPrompt(kpis, columns) }],
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${config.ai.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: config.ai.timeoutMs, // previously unbounded: a hung LLM call could hold an upload forever
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    throw new Error("LLM returned an empty completion");
  }
  return content;
};

/** Original, never-throwing API (kept for backwards compatibility): returns a fallback string on failure. */
const generateInsights = async (kpis, columns) => {
  try {
    return await generateInsightsStrict(kpis, columns);
  } catch (error) {
    logger.error({ err: error.response?.data || error.message }, "AI Insight Generation Error");
    return INSIGHTS_FALLBACK_MESSAGE;
  }
};

module.exports = { generateInsights, generateInsightsStrict, INSIGHTS_FALLBACK_MESSAGE };

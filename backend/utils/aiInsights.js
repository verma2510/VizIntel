const axios = require("axios");

const generateInsights = async (kpis, columns) => {
  try {
    const prompt = `
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

      COLUMN_STATS:
      ${JSON.stringify(stats)}
    `;

    const response = await axios.post(
      "https://api.deepseek.com/chat/completions",
      {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.AI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("AI Insight Generation Error:", error.response?.data || error.message);
    return "Failed to generate AI insights. Please check your AI_API_KEY or connection.";
  }
};

module.exports = { generateInsights };

const mongoose = require("mongoose");

const DatasetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    originalData: { type: Array, required: true }, // Store parsed JSON data
    columns: { type: Array, required: true },      // Store detected columns and their types
    kpis: { type: Object },                        // Computed KPIs like totals, averages, etc.
    charts: { type: Array },                       // Automatically selected chart configurations
    insights: { type: String },                    // AI generated insights text

    // Denormalised counters so list/summary queries never have to load `originalData` to count rows.
    // Older documents without them are handled with $ifNull/$size fallbacks (and `npm run db:backfill-stats`).
    rowCount: { type: Number },
    columnCount: { type: Number },

    // Insight lifecycle — lets generation run asynchronously (Kafka insights worker) and lets n8n retry
    // failures. Documents created before this field existed are treated as "ready".
    insightsStatus: { type: String, enum: ["pending", "ready", "failed"], default: "ready" },
    insightsRequestId: { type: String },  // guards against stale/duplicate generation results
    insightsAttempts: { type: Number, default: 0 },
    insightsError: { type: String },
    insightsUpdatedAt: { type: Date },
  },
  { timestamps: true }
);

// Serves the hottest query in the app: "this user's datasets, newest first" (list, search, summary).
DatasetSchema.index({ user: 1, createdAt: -1 });
// Serves the n8n insight-retry sweeper: failed / stale pending insights.
DatasetSchema.index({ insightsStatus: 1, updatedAt: 1 });
// Serves the scheduled (cross-user) activity report: "datasets uploaded in the last N days".
DatasetSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Dataset", DatasetSchema);

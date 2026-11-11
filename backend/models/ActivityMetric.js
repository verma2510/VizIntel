const mongoose = require("mongoose");

/**
 * Daily per-user activity rollup (one document per user per UTC day), maintained by the activity
 * aggregator consumer. Dashboards and the n8n weekly report read these small documents instead of
 * scanning raw events.
 */
const RankedSchema = new mongoose.Schema({ key: String, count: Number }, { _id: false });

const ActivityMetricSchema = new mongoose.Schema(
  {
    _id: { type: String },                                  // bucket: "<userId|anonymous>|<YYYY-MM-DD>"
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    day: { type: String, required: true },
    date: { type: Date, required: true },                   // start of the UTC day, for range queries
    pageViews: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    searches: { type: Number, default: 0 },
    uploads: { type: Number, default: 0 },
    totalEvents: { type: Number, default: 0 },
    uniqueSessions: { type: Number, default: 0 },
    topPages: { type: [RankedSchema], default: [] },
    topClicks: { type: [RankedSchema], default: [] },
    topSearches: { type: [RankedSchema], default: [] },
    firstEventAt: { type: Date },
    lastEventAt: { type: Date },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

ActivityMetricSchema.index({ user: 1, date: -1 });
ActivityMetricSchema.index({ date: -1 });

module.exports = mongoose.model("ActivityMetric", ActivityMetricSchema);

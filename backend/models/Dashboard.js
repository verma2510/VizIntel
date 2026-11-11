const mongoose = require("mongoose");

/**
 * A user-composed dashboard: an ordered list of widgets laid out on a 12-column grid.
 *
 * Widgets reference datasets by id and carry a free-form `spec` (chart spec, KPI config, table config or
 * note text) that the frontend renders against the dataset rows. The spec is validated and size-bounded
 * by the controller (see validators/dashboardSchemas.js), so Mixed is safe here.
 *
 * Sharing: a dashboard with a `shareToken` is readable (read-only) through GET /api/public/dashboards/:token.
 * Revoking sharing removes the token, which invalidates every link handed out before.
 */
const WidgetSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    kind: { type: String, enum: ["chart", "kpi", "table", "insights", "text"], required: true },
    title: { type: String, default: "" },
    datasetId: { type: mongoose.Schema.Types.ObjectId, ref: "Dataset", default: null },
    spec: { type: mongoose.Schema.Types.Mixed, default: {} },
    w: { type: Number, min: 2, max: 12, default: 6 }, // grid columns (of 12)
    h: { type: Number, min: 2, max: 10, default: 4 }, // grid rows
  },
  { _id: false }
);

const DashboardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    widgets: { type: [WidgetSchema], default: [] },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} }, // saved global filters (date range, ...)
    shareToken: { type: String },
    sharedAt: { type: Date },
  },
  { timestamps: true, minimize: false }
);

// "This user's dashboards, most recently edited first".
DashboardSchema.index({ user: 1, updatedAt: -1 });
// Public share lookups; sparse so unshared dashboards (no token) don't collide on null.
DashboardSchema.index({ shareToken: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Dashboard", DashboardSchema);

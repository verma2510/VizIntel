const { z } = require("zod");

/**
 * Request contracts for /api/dashboards. Widget specs are opaque to the API (the frontend owns the chart
 * engine), so they are only bounded in size — enough for a rich chart spec, never a smuggled dataset.
 */
const MAX_SPEC_BYTES = 16 * 1024;
const MAX_WIDGETS = 48;
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const boundedRecord = (maxBytes, label) =>
  z.record(z.string().max(64), z.unknown()).refine((value) => JSON.stringify(value).length <= maxBytes, {
    message: `${label} is too large (max ${Math.round(maxBytes / 1024)}KB)`,
  });

const widgetSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["chart", "kpi", "table", "insights", "text"]),
  title: z.string().max(200).default(""),
  datasetId: objectId.nullable().default(null),
  spec: boundedRecord(MAX_SPEC_BYTES, "Widget spec").default({}),
  w: z.number().int().min(2).max(12).default(6),
  h: z.number().int().min(2).max(10).default(4),
});

const widgetsSchema = z
  .array(widgetSchema)
  .max(MAX_WIDGETS, `A dashboard can hold at most ${MAX_WIDGETS} widgets`)
  .refine((widgets) => new Set(widgets.map((w) => w.id)).size === widgets.length, { message: "Widget ids must be unique" });

const filtersSchema = boundedRecord(4 * 1024, "Filters");

const createDashboardSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).default(""),
  widgets: widgetsSchema.default([]),
  filters: filtersSchema.default({}),
});

// Defined explicitly (not .partial()) so omitted fields stay omitted instead of being reset to defaults.
const updateDashboardSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120).optional(),
    description: z.string().trim().max(500).optional(),
    widgets: widgetsSchema.optional(),
    filters: filtersSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: "Nothing to update" });

module.exports = { createDashboardSchema, updateDashboardSchema, widgetSchema, MAX_WIDGETS, MAX_SPEC_BYTES };

const { z } = require("zod");
const datasetService = require("../services/datasetService");
const { sendCached } = require("../lib/cache");

// Thin HTTP layer: validation + response shaping. Business logic lives in services/datasetService.js.
// Errors propagate to middlewares/errorHandler.js (Express 5 forwards rejected promises automatically).

const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  include: z.enum(["data"]).optional(), // ?include=data restores the legacy "rows included" list payload
});

exports.uploadDataset = async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: "No file uploaded" });
  const dataset = await datasetService.createDataset({ userId: req.user.id, file: req.file });
  res.json(dataset);
};

exports.getDatasets = async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const { json, status } = await datasetService.listDatasetsCached({
    userId: req.user.id,
    q: query.q,
    page: query.page,
    limit: query.limit,
    includeData: query.include === "data",
  });
  const payload = JSON.parse(json);
  res.set({
    "X-Cache": status,
    "X-Total-Count": String(payload.total),
    "X-Page": String(payload.page),
    "X-Page-Size": String(payload.limit),
  });
  // Body stays a plain array for backwards compatibility; pagination metadata travels in headers.
  res.json(payload.items);
};

exports.getDatasetById = async (req, res) => {
  sendCached(res, await datasetService.getDatasetCached(req.user.id, req.params.id));
};

exports.getInsightsStatus = async (req, res) => {
  res.json(await datasetService.getInsightsStatus(req.user.id, req.params.id));
};

exports.regenerateInsights = async (req, res) => {
  const result = await datasetService.requestInsightsRegeneration({
    datasetId: req.params.id,
    userId: req.user.id,
    reason: "user",
  });
  res.status(202).json(result);
};

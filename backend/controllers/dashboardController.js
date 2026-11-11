const dashboardService = require("../services/dashboardService");
const { createDashboardSchema, updateDashboardSchema } = require("../validators/dashboardSchemas");
const { sendCached } = require("../lib/cache");

// Thin HTTP layer; ZodError -> 400 and NotFoundError -> 404 via middlewares/errorHandler.js.

exports.list = async (req, res) => {
  res.json(await dashboardService.listDashboards(req.user.id));
};

exports.get = async (req, res) => {
  res.json(await dashboardService.getDashboard(req.user.id, req.params.id));
};

exports.create = async (req, res) => {
  const input = createDashboardSchema.parse(req.body);
  res.status(201).json(await dashboardService.createDashboard(req.user.id, input));
};

exports.update = async (req, res) => {
  const patch = updateDashboardSchema.parse(req.body);
  res.json(await dashboardService.updateDashboard(req.user.id, req.params.id, patch));
};

exports.remove = async (req, res) => {
  await dashboardService.deleteDashboard(req.user.id, req.params.id);
  res.status(204).end();
};

exports.duplicate = async (req, res) => {
  res.status(201).json(await dashboardService.duplicateDashboard(req.user.id, req.params.id));
};

exports.share = async (req, res) => {
  res.json(await dashboardService.enableSharing(req.user.id, req.params.id));
};

exports.unshare = async (req, res) => {
  res.json(await dashboardService.disableSharing(req.user.id, req.params.id));
};

exports.getShared = async (req, res) => {
  sendCached(res, await dashboardService.getSharedDashboardCached(req.params.token));
};

const { z } = require("zod");
const reportService = require("../services/reportService");
const datasetService = require("../services/datasetService");
const eventBus = require("../lib/eventBus");
const { cacheStats } = require("../lib/cache");
const { redisStatus } = require("../lib/redis");
const { config } = require("../config/env");

// Service-to-service endpoints consumed by n8n workflows (protected by middlewares/internalAuth.js).

const backlogQuery = z.object({
  staleMinutes: z.coerce.number().int().min(1).max(1440).default(config.insights.staleAfterMinutes),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  maxAttempts: z.coerce.number().int().min(1).max(20).default(config.insights.maxAttempts),
});

exports.getInsightsBacklog = async (req, res) => {
  res.json(await reportService.getInsightsBacklog(backlogQuery.parse(req.query)));
};

exports.requestInsights = async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 50) : "n8n";
  res.status(202).json(await datasetService.requestInsightsRegeneration({ datasetId: req.params.id, reason }));
};

exports.getActivityReport = async (req, res) => {
  const days = z.coerce.number().int().min(1).max(31).default(7).parse(req.query.days);
  res.json(await reportService.buildActivityReport({ days }));
};

exports.getPipelineStatus = async (req, res) => {
  res.json({
    insightsMode: config.insights.mode,
    eventBus: eventBus.health(),
    redis: redisStatus(),
    cache: cacheStats(),
  });
};

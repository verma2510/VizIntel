const express = require("express");
const router = express.Router();
const internalController = require("../controllers/internalController");
const internalAuth = require("../middlewares/internalAuth");

// Machine-to-machine API for n8n workflows. Never exposed to browsers (no user JWT accepted here).
router.use(internalAuth);
router.get("/insights/backlog", internalController.getInsightsBacklog);
router.post("/datasets/:id/insights", internalController.requestInsights);
router.get("/reports/activity", internalController.getActivityReport);
router.get("/pipeline", internalController.getPipelineStatus);

module.exports = router;

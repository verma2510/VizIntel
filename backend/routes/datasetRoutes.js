const express = require("express");
const router = express.Router();
const datasetController = require("../controllers/datasetController");
const auth = require("../middlewares/auth");
const upload = require("../middlewares/upload");
const rateLimit = require("../middlewares/rateLimit");
const { config } = require("../config/env");

const uploadLimiter = rateLimit({ name: "uploads", max: config.rateLimit.uploadsPerMinute });

// Protected routes to upload and fetch datasets
router.post("/upload", [auth, uploadLimiter, upload.single("file")], datasetController.uploadDataset);
router.get("/", auth, datasetController.getDatasets);
router.get("/:id", auth, datasetController.getDatasetById);
router.get("/:id/insights", auth, datasetController.getInsightsStatus);
router.post("/:id/insights/regenerate", [auth, uploadLimiter], datasetController.regenerateInsights);

module.exports = router;

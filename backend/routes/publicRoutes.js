const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");
const rateLimit = require("../middlewares/rateLimit");
const { config } = require("../config/env");

// Unauthenticated, read-only endpoints (shared dashboard links). Rate limited per IP.
const publicLimiter = rateLimit({ name: "public", max: config.rateLimit.publicPerMinute, keyFn: (req) => req.ip });

router.get("/dashboards/:token", publicLimiter, dashboardController.getShared);

module.exports = router;

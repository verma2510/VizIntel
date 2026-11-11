const express = require("express");
const router = express.Router();
const eventController = require("../controllers/eventController");
const optionalAuth = require("../middlewares/optionalAuth");
const rateLimit = require("../middlewares/rateLimit");
const { config } = require("../config/env");

router.post(
  "/",
  optionalAuth,
  rateLimit({ name: "events", max: config.rateLimit.eventsPerMinute, keyFn: (req) => req.user?.id || req.ip }),
  eventController.ingestEvents
);

module.exports = router;

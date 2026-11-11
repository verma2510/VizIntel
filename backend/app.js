const express = require("express");
const cors = require("cors");
const compression = require("compression");
const mongoose = require("mongoose");
const { config } = require("./config/env");
const requestLogger = require("./middlewares/requestLogger");
const { errorHandler, notFound } = require("./middlewares/errorHandler");
const authRoutes = require("./routes/authRoutes");
const datasetRoutes = require("./routes/datasetRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const eventRoutes = require("./routes/eventRoutes");
const activityRoutes = require("./routes/activityRoutes");
const internalRoutes = require("./routes/internalRoutes");
const eventBus = require("./lib/eventBus");
const { redisStatus } = require("./lib/redis");
const { cacheStats } = require("./lib/cache");

/** Builds the Express app without side effects (no DB connect / listen) so it can be tested in isolation. */
function createApp() {
  const app = express();

  if (config.trustProxy) {
    const hops = Number(config.trustProxy);
    app.set("trust proxy", Number.isNaN(hops) ? config.trustProxy : hops);
  }
  app.disable("x-powered-by");

  // Middleware
  app.use(requestLogger);
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : "*",
      exposedHeaders: ["X-Request-Id", "X-Cache", "X-Total-Count", "X-Page", "X-Page-Size", "Retry-After", "RateLimit-Remaining"],
    })
  );
  // gzip JSON responses: dataset payloads (row arrays) typically compress 5-10x.
  app.use(compression({ threshold: 1024 }));
  // Tight body limit for the public, high-volume ingestion endpoint (parsed first; the global parser then skips it).
  app.use("/api/events", express.json({ limit: "64kb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use("/api/auth", authRoutes);
  app.use("/api/datasets", datasetRoutes);
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/events", eventRoutes);
  app.use("/api/activity", activityRoutes);
  app.use("/api/internal", internalRoutes);

  // Liveness probe used by UptimeRobot to keep the free-tier instance awake — response kept unchanged.
  app.get("/health", (req, res) => {
    res.status(200).send("Server is awake and running");
  });

  // Readiness probe: dependency status. Only MongoDB is required; Redis/Kafka degrade gracefully.
  app.get("/health/ready", (req, res) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const bus = eventBus.health();
    res.status(mongoReady ? 200 : 503).json({
      status: mongoReady ? "ok" : "unavailable",
      uptimeSec: Math.round(process.uptime()),
      mongo: { ready: mongoReady },
      redis: redisStatus(),
      kafka: { mode: bus.mode, healthy: bus.healthy, producerReady: bus.producerReady, outboxSize: bus.outboxSize, lastError: bus.lastError },
      cache: cacheStats(),
      insightsMode: config.insights.mode,
    });
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

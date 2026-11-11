const { config, assertConfig } = require("./config/env");
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const { createApp } = require("./app");
const eventBus = require("./lib/eventBus");
const { getRedis, closeRedis } = require("./lib/redis");
const { SUBSCRIPTIONS } = require("./events/registry");
const logger = require("./lib/logger");

assertConfig(["mongo.uri", "jwtSecret"]);

// Connect to DB (and Redis, which is optional and connects in the background)
connectDB();
getRedis();

// In-process handlers: the primary processors in inline mode, the fallback for critical events in Kafka mode.
eventBus.registerSubscriptions(SUBSCRIPTIONS);
eventBus.start();

const app = createApp();
const PORT = config.port;
const server = app.listen(PORT, () =>
  logger.info(
    { port: PORT, eventTransport: config.kafka.enabled ? "kafka" : "inline", redis: config.redis.enabled, insightsMode: config.insights.mode },
    `Server running on port ${PORT}`
  )
);

// Graceful shutdown: stop accepting connections, drain the event outbox, then close connections.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down API");
  const forceExit = setTimeout(() => process.exit(1), 15000);
  forceExit.unref();
  server.close();
  try {
    await eventBus.shutdown();
    await mongoose.disconnect();
    await closeRedis();
  } finally {
    process.exit(0);
  }
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error({ err: reason?.message || reason }, "Unhandled rejection"));

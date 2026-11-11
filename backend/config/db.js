const mongoose = require("mongoose");
const { config } = require("./env");
const logger = require("../lib/logger").child({ component: "mongo" });

let connecting = null;

/**
 * Idempotent connect shared by the API and the standalone workers. Pool sizing is env-driven so each
 * process type can be tuned independently (e.g. a small pool for the insights worker, larger for the API).
 */
const connectDB = async ({ exitOnFailure = true } = {}) => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connecting) {
    connecting = mongoose.connect(config.mongo.uri, {
      maxPoolSize: config.mongo.maxPoolSize,
      minPoolSize: config.mongo.minPoolSize,
      serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMS,
      autoIndex: config.mongo.autoIndex,
    });
  }
  try {
    await connecting;
    logger.info("MongoDB connected successfully");
    return mongoose.connection;
  } catch (error) {
    connecting = null;
    logger.fatal({ err: error.message }, "MongoDB connection error");
    if (exitOnFailure) process.exit(1);
    throw error;
  }
};

module.exports = connectDB;

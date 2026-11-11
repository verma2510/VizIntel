/**
 * Structured JSON logging (pino). One logger per process; modules derive children with context
 * (e.g. logger.child({ component: "eventBus" })) so every line is filterable in a log aggregator.
 */
const pino = require("pino");
const { config } = require("../config/env");

let transport;
if (config.logPretty && !config.isTest) {
  try {
    require.resolve("pino-pretty");
    transport = {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,env" },
    };
  } catch {
    // pino-pretty is a dev dependency; fall back to JSON when it isn't installed.
  }
}

const logger = pino({
  level: config.isTest ? "silent" : config.logLevel,
  base: { service: config.serviceName, env: config.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-internal-api-key"]',
      "password",
      "*.password",
      "token",
    ],
    censor: "[redacted]",
  },
  transport,
});

module.exports = logger;

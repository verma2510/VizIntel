const crypto = require("crypto");
const pinoHttp = require("pino-http");
const logger = require("../lib/logger");

const SAFE_REQUEST_ID = /^[\w.-]{1,64}$/;

/**
 * Structured access log with a correlation id per request. Honours an incoming X-Request-Id (from a
 * proxy / the browser) when it is well-formed, echoes it back, and exposes req.log for handlers.
 * Health probes (UptimeRobot) are not logged.
 */
module.exports = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  autoLogging: { ignore: (req) => req.url.startsWith("/health") || req.method === "OPTIONS" },
  customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode, cache: res.getHeader?.("x-cache") }),
  },
});

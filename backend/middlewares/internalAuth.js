const crypto = require("crypto");
const { config } = require("../config/env");

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();

/**
 * Service-to-service auth for /api/internal (called by n8n). Requires the X-Internal-Api-Key header.
 * Compares SHA-256 digests with timingSafeEqual (constant time, no length leak). The whole internal
 * surface is disabled unless INTERNAL_API_KEY is configured.
 */
module.exports = function internalAuth(req, res, next) {
  if (!config.internalApiKey) {
    return res.status(503).json({ msg: "Internal API disabled: INTERNAL_API_KEY is not configured" });
  }
  const provided = req.header("X-Internal-Api-Key") || "";
  if (!crypto.timingSafeEqual(digest(provided), digest(config.internalApiKey))) {
    return res.status(401).json({ msg: "Invalid internal API key" });
  }
  next();
};

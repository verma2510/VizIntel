const jwt = require("jsonwebtoken");

/**
 * Like auth.js but never rejects: a valid bearer token attributes the request to a user, anything else
 * (missing/expired/invalid) is treated as anonymous. Used by the event ingestion endpoint so tracking
 * works on the login page and can never trigger a client-side logout loop.
 */
module.exports = function optionalAuth(req, res, next) {
  const header = req.header("Authorization");
  if (header) {
    try {
      const token = header.startsWith("Bearer ") ? header.slice(7) : header;
      req.user = jwt.verify(token, process.env.JWT_SECRET).user;
    } catch {
      req.user = undefined;
    }
  }
  next();
};

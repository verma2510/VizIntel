const multer = require("multer");
const { ZodError } = require("zod");
const { AppError } = require("../lib/errors");
const { config } = require("../config/env");

/**
 * Central error handler (Express 5 forwards rejected async handlers here automatically).
 * Keeps the response shape the frontend already understands: { msg }, plus a code and the request id
 * so a user-reported error can be matched to its log line.
 */
function errorHandler(err, req, res, _next) {
  let status = 500;
  let msg = "Server Error";
  let code = "INTERNAL_ERROR";
  let details;

  if (err instanceof AppError) {
    ({ status, code, details } = err);
    msg = err.message;
  } else if (err instanceof multer.MulterError) {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    code = err.code;
    msg = err.code === "LIMIT_FILE_SIZE" ? `File too large (max ${config.upload.maxFileMb}MB)` : err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    code = "VALIDATION_ERROR";
    msg = "Invalid request";
    details = err.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message }));
  } else if (err.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    msg = "Request body too large";
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    msg = "Malformed JSON body";
  }

  if (status >= 500) {
    req.log?.error({ err }, "Unhandled request error");
  } else {
    req.log?.warn({ code, msg }, "Request rejected");
  }

  if (res.headersSent) return;
  res.status(status).json({ msg, code, ...(details ? { details } : {}), requestId: req.id });
}

function notFound(req, res) {
  res.status(404).json({ msg: `Route not found: ${req.method} ${req.path}`, code: "NOT_FOUND" });
}

module.exports = { errorHandler, notFound };

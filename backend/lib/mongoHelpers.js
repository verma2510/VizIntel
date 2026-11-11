const mongoose = require("mongoose");

/** Returns an ObjectId for a valid 24-hex id string, else null (avoids CastErrors surfacing as 500s). */
const toObjectId = (id) => {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return typeof id === "string" && /^[a-f\d]{24}$/i.test(id) ? new mongoose.Types.ObjectId(id) : null;
};

/** Escapes user input for safe use inside a $regex (prevents ReDoS / regex injection). */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Row/column counts that work for legacy documents created before rowCount/columnCount existed. */
const rowCountExpr = { $ifNull: ["$rowCount", { $size: { $ifNull: ["$originalData", []] } }] };
const columnCountExpr = { $ifNull: ["$columnCount", { $size: { $ifNull: ["$columns", []] } }] };

module.exports = { toObjectId, escapeRegex, rowCountExpr, columnCountExpr };

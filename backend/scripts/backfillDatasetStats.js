/**
 * One-off migration for datasets created before rowCount/columnCount/insightsStatus existed.
 *   npm run db:backfill-stats
 * Uses a single pipeline-style updateMany so the row arrays are counted inside MongoDB and never
 * transferred to Node. Idempotent: only touches documents still missing the fields.
 */
const mongoose = require("mongoose");
const { assertConfig } = require("../config/env");
const connectDB = require("../config/db");
const Dataset = require("../models/Dataset");

async function main() {
  assertConfig(["mongo.uri"]);
  await connectDB();
  const result = await Dataset.updateMany(
    { $or: [{ rowCount: { $exists: false } }, { columnCount: { $exists: false } }, { insightsStatus: { $exists: false } }] },
    [
      {
        $set: {
          rowCount: { $ifNull: ["$rowCount", { $size: { $ifNull: ["$originalData", []] } }] },
          columnCount: { $ifNull: ["$columnCount", { $size: { $ifNull: ["$columns", []] } }] },
          insightsStatus: { $ifNull: ["$insightsStatus", "ready"] },
        },
      },
    ],
    { updatePipeline: true }
  );
  console.log(`Matched ${result.matchedCount}, updated ${result.modifiedCount} dataset(s).`);
  await mongoose.disconnect();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Backfill failed:", err.message);
    process.exit(1);
  }
);

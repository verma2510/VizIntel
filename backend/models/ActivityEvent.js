const mongoose = require("mongoose");
const { config } = require("../config/env");

/**
 * Raw activity events written by the activity aggregator consumer.
 *
 * Doubles as the idempotency ledger: _id IS the eventId, so a redelivered Kafka message upserts onto the
 * same document instead of creating a duplicate. Rolled-up metrics (ActivityMetric) are recomputed from
 * these rows, which makes the aggregation idempotent by construction. A TTL index bounds storage.
 */
const ActivityEventSchema = new mongoose.Schema(
  {
    _id: { type: String },                                  // eventId
    type: { type: String, required: true },                 // page_view | click | search | dataset_uploaded
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    anonymousId: { type: String, default: null },
    sessionId: { type: String, default: null },
    bucket: { type: String, required: true },               // "<userId|anonymous>|<YYYY-MM-DD>"
    day: { type: String, required: true },                  // YYYY-MM-DD (UTC)
    key: { type: String, default: null },                   // path / click target / normalised search term
    path: { type: String, default: null },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

ActivityEventSchema.index({ bucket: 1, type: 1 });
ActivityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: config.events.rawRetentionDays * 24 * 3600 });

module.exports = mongoose.model("ActivityEvent", ActivityEventSchema);

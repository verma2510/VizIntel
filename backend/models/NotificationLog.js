const mongoose = require("mongoose");

/**
 * Outbox-style delivery ledger for outbound n8n notifications. _id = "<eventId>:<channel>", so a Kafka
 * redelivery of an already-sent event is detected and skipped (no duplicate emails).
 */
const NotificationLogSchema = new mongoose.Schema(
  {
    _id: { type: String },
    eventId: { type: String, required: true },
    channel: { type: String, required: true },              // e.g. n8n:dataset-uploaded
    status: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending" },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    sentAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

NotificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

module.exports = mongoose.model("NotificationLog", NotificationLogSchema);

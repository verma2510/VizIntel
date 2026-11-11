/**
 * Event contracts (zod). Two layers:
 *  1. clientEventSchema — what the browser may send to POST /api/events (untrusted input, strictly bounded).
 *  2. envelopeSchema    — the canonical envelope every Kafka message carries (validated again by consumers,
 *                         so a malformed message is routed to the DLQ instead of crashing a worker).
 */
const crypto = require("crypto");
const { z } = require("zod");
const { config } = require("../config/env");

const CLIENT_EVENT_TYPES = ["page_view", "click", "search"];
const MAX_PROPERTIES = 20;

const propertyValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

const clientEventSchema = z
  .object({
    eventId: z.uuid().optional(), // client-generated => retries of the same batch are de-duplicated downstream
    type: z.enum(CLIENT_EVENT_TYPES),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    sessionId: z.string().min(1).max(64).optional(),
    path: z.string().max(512).optional(),
    properties: z.record(z.string().max(64), propertyValue).default({}),
  })
  .superRefine((event, ctx) => {
    if (Object.keys(event.properties).length > MAX_PROPERTIES) {
      ctx.addIssue({ code: "custom", message: `At most ${MAX_PROPERTIES} properties allowed`, path: ["properties"] });
    }
    if (event.type === "search") {
      const query = event.properties.query;
      if (typeof query !== "string" || !query.trim()) {
        ctx.addIssue({ code: "custom", message: "search events require properties.query", path: ["properties", "query"] });
      }
    }
    if (event.type === "click" && typeof event.properties.target !== "string") {
      ctx.addIssue({ code: "custom", message: "click events require properties.target", path: ["properties", "target"] });
    }
  });

const clientBatchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(config.events.maxClientBatch),
});

const envelopeSchema = z.object({
  eventId: z.string().min(8).max(128),
  type: z.string().min(1).max(64),
  version: z.number().int().positive(),
  occurredAt: z.iso.datetime({ offset: true }),
  receivedAt: z.iso.datetime({ offset: true }),
  source: z.enum(["web", "api", "worker"]),
  userId: z.string().max(64).nullable(),
  anonymousId: z.string().max(64).nullable(),
  sessionId: z.string().max(64).nullable(),
  data: z.record(z.string(), z.unknown()),
});

/**
 * Builds a canonical event envelope. Pass a deterministic `eventId` for derived/domain events
 * (e.g. `insights-generated:<requestId>`) so a retried producer emits the SAME id and downstream
 * idempotency checks collapse the duplicate.
 */
function buildEnvelope({
  type,
  data = {},
  userId = null,
  anonymousId = null,
  sessionId = null,
  source = "api",
  eventId,
  occurredAt,
}) {
  const now = new Date().toISOString();
  return {
    eventId: eventId || crypto.randomUUID(),
    type,
    version: 1,
    occurredAt: occurredAt || now,
    receivedAt: now,
    source,
    userId: userId ? String(userId) : null,
    anonymousId,
    sessionId,
    data,
  };
}

/**
 * Untrusted client clocks are clamped: anything in the future (>5 min skew) or older than
 * ACTIVITY_MAX_EVENT_AGE_DAYS is stamped with the server receive time instead.
 */
function normalizeOccurredAt(value, now = new Date()) {
  if (!value) return now.toISOString();
  const ts = new Date(value);
  const maxAgeMs = config.events.maxEventAgeDays * 24 * 60 * 60 * 1000;
  if (Number.isNaN(ts.getTime()) || ts.getTime() > now.getTime() + 5 * 60 * 1000 || ts.getTime() < now.getTime() - maxAgeMs) {
    return now.toISOString();
  }
  return ts.toISOString();
}

/** Converts a validated client event into a Kafka envelope enriched with server-side identity. */
function fromClientEvent(event, { userId, userAgent }) {
  return buildEnvelope({
    eventId: event.eventId,
    type: event.type,
    source: "web",
    userId: userId || null,
    anonymousId: userId ? null : event.sessionId || null,
    sessionId: event.sessionId || null,
    occurredAt: normalizeOccurredAt(event.occurredAt),
    data: {
      path: event.path || null,
      properties: event.properties,
      userAgent: userAgent ? String(userAgent).slice(0, 256) : null,
    },
  });
}

module.exports = {
  CLIENT_EVENT_TYPES,
  clientEventSchema,
  clientBatchSchema,
  envelopeSchema,
  buildEnvelope,
  normalizeOccurredAt,
  fromClientEvent,
};

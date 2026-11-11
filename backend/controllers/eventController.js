const eventBus = require("../lib/eventBus");
const { CLIENT_EVENT_TOPICS } = require("../events/topics");
const { clientBatchSchema, clientEventSchema, fromClientEvent } = require("../events/schemas");
const { BadRequestError } = require("../lib/errors");

/**
 * POST /api/events — the Kafka PRODUCER edge for browser interactions.
 *
 * Validates each event independently (one bad event never rejects the batch), enriches it with the
 * authenticated user, routes it to its topic and hands it to the micro-batching outbox. Responds 202
 * without touching MongoDB — ingestion latency is decoupled from database load by Kafka.
 * When the outbox is saturated it answers 503 + Retry-After (backpressure) and the client retries later.
 */
exports.ingestEvents = async (req, res) => {
  const batch = clientBatchSchema.safeParse(req.body);
  if (!batch.success) {
    throw new BadRequestError(
      "Expected { events: [...] } with 1-50 events",
      batch.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }

  const userId = req.user?.id || null;
  const userAgent = req.get("user-agent");
  const byTopic = new Map();
  const errors = [];

  batch.data.events.forEach((raw, index) => {
    const parsed = clientEventSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ index, issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const topic = CLIENT_EVENT_TOPICS[parsed.data.type];
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(fromClientEvent(parsed.data, { userId, userAgent }));
  });

  const validCount = [...byTopic.values()].reduce((sum, events) => sum + events.length, 0);
  if (validCount > 0 && !eventBus.hasCapacity(validCount)) {
    res.set("Retry-After", "5");
    return res.status(503).json({ msg: "Event pipeline is saturated, retry later", code: "BACKPRESSURE" });
  }

  let accepted = 0;
  for (const [topic, events] of byTopic) accepted += eventBus.enqueue(topic, events).accepted;

  res.status(202).json({ accepted, rejected: batch.data.events.length - accepted, errors });
};

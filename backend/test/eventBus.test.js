process.env.NODE_ENV = "test";
process.env.KAFKA_ENABLED = "false";
process.env.EVENTS_OUTBOX_MAX = "5";
process.env.EVENTS_FLUSH_INTERVAL_MS = "5";
const test = require("node:test");
const assert = require("node:assert/strict");
const eventBus = require("../lib/eventBus");
const { buildEnvelope } = require("../events/schemas");
const { sleep } = require("../lib/retry");

const received = { activity: [], notify: [], critical: [] };
let failNext = 0;

eventBus.registerSubscriptions([
  {
    name: "activity",
    topics: ["t.activity"],
    handler: async (events) => {
      if (failNext > 0) {
        failNext--;
        throw new Error("simulated MongoDB outage");
      }
      received.activity.push(...events);
    },
  },
  { name: "notify", topics: ["t.critical"], handler: async (events) => received.notify.push(...events) },
  { name: "critical", topics: ["t.critical"], handler: async (events) => received.critical.push(...events) },
]);

const ev = (n) => buildEnvelope({ type: "click", eventId: `event-${String(n).padStart(4, "0")}` });

test("inline mode: enqueued events are micro-batched to the in-process handler", async () => {
  const result = eventBus.enqueue("t.activity", [ev(1), ev(2)]);
  assert.deepEqual(result, { accepted: 2, rejected: 0 });
  await sleep(50);
  assert.deepEqual(received.activity.map((e) => e.eventId), ["event-0001", "event-0002"]);
});

test("outbox is bounded: excess events are rejected and capacity is reported", () => {
  assert.equal(eventBus.hasCapacity(5), true);
  assert.equal(eventBus.hasCapacity(6), false);
  const result = eventBus.enqueue("t.activity", [ev(10), ev(11), ev(12), ev(13), ev(14), ev(15), ev(16)]);
  assert.deepEqual(result, { accepted: 5, rejected: 2 });
});

test("failed flushes are retried with backoff and nothing is lost", async () => {
  await sleep(50); // drain previous test
  received.activity.length = 0;
  failNext = 2;
  eventBus.enqueue("t.activity", [ev(20), ev(21)]);
  for (let i = 0; i < 60 && received.activity.length < 2; i++) await sleep(100);
  assert.deepEqual(received.activity.map((e) => e.eventId), ["event-0020", "event-0021"]);
  assert.ok(eventBus.health().stats.publishFailures >= 2);
});

test("publish() fans out to every subscription of a topic (consumer-group semantics)", async () => {
  const result = await eventBus.publish("t.critical", ev(30));
  assert.equal(result.transport, "inline");
  await sleep(30);
  assert.equal(received.notify.length, 1);
  assert.equal(received.critical.length, 1);
});

test("health reports inline mode", () => {
  const health = eventBus.health();
  assert.equal(health.mode, "inline");
  assert.equal(health.producerReady, null);
});

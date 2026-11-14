process.env.NODE_ENV = "test";
process.env.KAFKA_BROKERS = "broker.example.com:9092";
process.env.KAFKA_SSL_CA = "-----BEGIN CERTIFICATE-----\\nMIIBfake\\n-----END CERTIFICATE-----\\n"; // single-line form, as pasted into env UIs
process.env.KAFKA_SINGLE_ACTIVITY_TOPIC = "true";
process.env.KAFKA_ACTIVITY_PARTITIONS = "2";
process.env.KAFKA_TOPIC_PREFIX = "t";
delete process.env.KAFKA_SSL_CA_FILE;

const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../config/env");
const { TOPICS, TOPIC_SPECS } = require("../events/topics");
const { SUBSCRIPTIONS } = require("../events/registry");

test("KAFKA_SSL_CA enables TLS against the private CA and restores newlines", () => {
  assert.equal(typeof config.kafka.ssl, "object");
  assert.equal(config.kafka.ssl.rejectUnauthorized, true);
  assert.equal(config.kafka.ssl.ca.length, 1);
  assert.equal(config.kafka.ssl.ca[0], "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----");
});

test("single activity topic: 5 topics, none above the partition cap", () => {
  assert.equal(TOPICS.PAGE_VIEWS, "t.activity");
  assert.equal(TOPICS.CLICKS, TOPICS.PAGE_VIEWS);
  assert.equal(TOPICS.SEARCHES, TOPICS.PAGE_VIEWS);

  const names = TOPIC_SPECS.map((spec) => spec.topic);
  assert.equal(new Set(names).size, names.length, "no duplicate topic specs");
  assert.equal(names.length, 5);
  for (const spec of TOPIC_SPECS) assert.ok(spec.numPartitions <= 2, `${spec.topic} has ${spec.numPartitions} partitions`);
});

test("subscriptions never list the same topic twice (inline mode would double-process)", () => {
  for (const subscription of SUBSCRIPTIONS) {
    assert.equal(new Set(subscription.topics).size, subscription.topics.length, subscription.name);
  }
});

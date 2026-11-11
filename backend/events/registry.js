/**
 * Subscription registry: which consumer group handles which topics, with what handler and tuning.
 *
 * The SAME definitions drive both deployment shapes:
 *  - Kafka mode: each entry becomes a standalone consumer group (workers/*.js). Groups receive every
 *    message independently (pub/sub fan-out); instances WITHIN a group split partitions (horizontal scale).
 *  - Inline mode: lib/eventBus registers each handler in-process, mirroring the fan-out semantics.
 */
const { TOPICS, CONSUMER_GROUPS } = require("./topics");
const { handleActivityEvents } = require("./handlers/activityHandler");
const { handleNotificationEvents } = require("./handlers/notificationHandler");
const { handleInsightsRequests } = require("./handlers/insightsHandler");

const SUBSCRIPTIONS = [
  {
    name: "activity",
    groupId: CONSUMER_GROUPS.ACTIVITY,
    topics: [TOPICS.PAGE_VIEWS, TOPICS.CLICKS, TOPICS.SEARCHES, TOPICS.DATASET_UPLOADED],
    handler: handleActivityEvents,
    batchSize: 500, // large batches amortise MongoDB round trips — this is where Kafka "buffers" DB load
    partitionsConsumedConcurrently: 3,
    sessionTimeout: 30000,
  },
  {
    name: "notifications",
    groupId: CONSUMER_GROUPS.NOTIFIER,
    topics: [TOPICS.DATASET_UPLOADED, TOPICS.INSIGHTS_GENERATED],
    handler: handleNotificationEvents,
    batchSize: 10,
    partitionsConsumedConcurrently: 2,
    sessionTimeout: 45000,
  },
  {
    name: "insights",
    groupId: CONSUMER_GROUPS.INSIGHTS,
    topics: [TOPICS.INSIGHTS_REQUESTED],
    handler: handleInsightsRequests,
    batchSize: 1, // one slow LLM call per unit of work; keeps heartbeats and retries simple
    partitionsConsumedConcurrently: 2,
    sessionTimeout: 90000,
    maxAttempts: 3,
  },
];

function getSubscription(name) {
  const subscription = SUBSCRIPTIONS.find((s) => s.name === name);
  if (!subscription) {
    throw new Error(`Unknown worker "${name}". Valid: ${SUBSCRIPTIONS.map((s) => s.name).join(", ")}`);
  }
  return subscription;
}

module.exports = { SUBSCRIPTIONS, getSubscription };

/**
 * Standalone consumer: `npm run worker:notifications`. Scale horizontally by running more instances —
 * Kafka splits the topic partitions across members of the "notifications" consumer group.
 */
const { runWorkers } = require("./runtime");
const { getSubscription } = require("../events/registry");

runWorkers([getSubscription("notifications")]);

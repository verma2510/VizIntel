/**
 * Standalone consumer: `npm run worker:activity`. Scale horizontally by running more instances —
 * Kafka splits the topic partitions across members of the "activity" consumer group.
 */
const { runWorkers } = require("./runtime");
const { getSubscription } = require("../events/registry");

runWorkers([getSubscription("activity")]);

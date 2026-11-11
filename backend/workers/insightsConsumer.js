/**
 * Standalone consumer: `npm run worker:insights`. Scale horizontally by running more instances —
 * Kafka splits the topic partitions across members of the "insights" consumer group.
 */
const { runWorkers } = require("./runtime");
const { getSubscription } = require("../events/registry");

runWorkers([getSubscription("insights")]);

/**
 * Kafka topic & consumer-group catalogue — the single source of truth for names, partitioning and retention.
 * Names are prefixed (KAFKA_TOPIC_PREFIX) so dev/staging/prod can share a cluster without collisions.
 */
const { config } = require("../config/env");

const prefix = config.kafka.topicPrefix;
const DAY_MS = 24 * 60 * 60 * 1000;

const TOPICS = Object.freeze({
  PAGE_VIEWS: `${prefix}.activity.page-views`,
  CLICKS: `${prefix}.activity.clicks`,
  SEARCHES: `${prefix}.activity.searches`,
  DATASET_UPLOADED: `${prefix}.datasets.uploaded`,
  INSIGHTS_REQUESTED: `${prefix}.insights.requested`,
  INSIGHTS_GENERATED: `${prefix}.insights.generated`,
  DLQ: `${prefix}.dlq`,
});

const activityPartitions = config.kafka.activityPartitions;

/**
 * High-volume activity topics get more partitions (parallelism ceiling for the aggregator group) and
 * short retention (they're rolled up into MongoDB). Domain events keep longer retention for replay.
 */
const TOPIC_SPECS = [
  { topic: TOPICS.PAGE_VIEWS, numPartitions: activityPartitions, retentionMs: 7 * DAY_MS },
  { topic: TOPICS.CLICKS, numPartitions: activityPartitions, retentionMs: 7 * DAY_MS },
  { topic: TOPICS.SEARCHES, numPartitions: Math.max(1, Math.ceil(activityPartitions / 2)), retentionMs: 7 * DAY_MS },
  { topic: TOPICS.DATASET_UPLOADED, numPartitions: 3, retentionMs: 14 * DAY_MS },
  { topic: TOPICS.INSIGHTS_REQUESTED, numPartitions: 3, retentionMs: 14 * DAY_MS },
  { topic: TOPICS.INSIGHTS_GENERATED, numPartitions: 3, retentionMs: 14 * DAY_MS },
  { topic: TOPICS.DLQ, numPartitions: 1, retentionMs: 30 * DAY_MS },
];

/** Client-side (browser) event types and the topic each one is routed to. */
const CLIENT_EVENT_TOPICS = Object.freeze({
  page_view: TOPICS.PAGE_VIEWS,
  click: TOPICS.CLICKS,
  search: TOPICS.SEARCHES,
});

/**
 * Domain events that drive user-visible features. If Kafka is unreachable these fall back to in-process
 * handlers instead of being buffered, so an upload notification / insight generation is never lost to
 * a broker outage. Activity events are buffered in the outbox instead (see lib/eventBus.js).
 */
const CRITICAL_TOPICS = new Set([TOPICS.DATASET_UPLOADED, TOPICS.INSIGHTS_REQUESTED, TOPICS.INSIGHTS_GENERATED]);

const CONSUMER_GROUPS = Object.freeze({
  ACTIVITY: `${prefix}.activity-aggregator`,
  NOTIFIER: `${prefix}.notifier`,
  INSIGHTS: `${prefix}.insights-worker`,
});

module.exports = { TOPICS, TOPIC_SPECS, CLIENT_EVENT_TOPICS, CRITICAL_TOPICS, CONSUMER_GROUPS };

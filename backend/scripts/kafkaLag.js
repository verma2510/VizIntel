/**
 * Consumer-group health report: state, member count and per-partition lag for every worker group.
 *   npm run kafka:lag
 * Lag = log-end offset - committed offset. Sustained growth means consumers can't keep up -> add
 * instances (up to the partition count) or raise batch sizes.
 */
const { getKafka } = require("../lib/kafka");
const { SUBSCRIPTIONS } = require("../events/registry");

async function main() {
  const kafka = getKafka();
  if (!kafka) throw new Error("KAFKA_BROKERS is not set");
  const admin = kafka.admin();
  await admin.connect();
  try {
    const { groups } = await admin.describeGroups(SUBSCRIPTIONS.map((s) => s.groupId));
    console.table(groups.map((g) => ({ group: g.groupId, state: g.state, members: g.members.length })));

    const rows = [];
    for (const subscription of SUBSCRIPTIONS) {
      const committed = await admin.fetchOffsets({ groupId: subscription.groupId, topics: subscription.topics });
      for (const { topic, partitions } of committed) {
        const ends = new Map((await admin.fetchTopicOffsets(topic)).map((p) => [p.partition, p]));
        for (const { partition, offset } of partitions) {
          const end = ends.get(partition);
          const committedOffset = Number(offset);
          const high = Number(end?.high ?? 0);
          const low = Number(end?.low ?? 0);
          rows.push({
            group: subscription.name,
            topic,
            partition,
            committed: committedOffset < 0 ? "none" : committedOffset,
            end: high,
            lag: high - Math.max(committedOffset, low),
          });
        }
      }
    }
    console.table(rows);
    const totalLag = rows.reduce((sum, r) => sum + r.lag, 0);
    console.log(`Total lag across groups: ${totalLag}`);
  } finally {
    await admin.disconnect();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Lag report failed:", err.message);
    process.exit(1);
  }
);

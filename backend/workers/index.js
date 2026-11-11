/**
 * Runs several consumer groups in ONE process — handy for small deployments and local development.
 *   WORKERS=activity,notifications,insights npm run workers   (default: all)
 * In production prefer one process per group (workers/*Consumer.js) so each scales independently.
 */
const { runWorkers } = require("./runtime");
const { SUBSCRIPTIONS, getSubscription } = require("../events/registry");

const selected = (process.env.WORKERS || "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

runWorkers(selected.length ? selected.map(getSubscription) : SUBSCRIPTIONS);

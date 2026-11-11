process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { signPayload, verifySignature } = require("../lib/n8n");
const { extractBullets } = require("../events/handlers/notificationHandler");

const SECRET = "test-secret";

test("signature round-trips and rejects tampering", () => {
  const body = JSON.stringify({ event: "dataset.uploaded", dataset: { id: "1" } });
  const ts = String(Date.now());
  const sig = signPayload(body, ts, SECRET);
  assert.match(sig, /^sha256=[a-f0-9]{64}$/);
  assert.equal(verifySignature(body, ts, sig, SECRET), true);
  assert.equal(verifySignature(body.replace("1", "2"), ts, sig, SECRET), false);
  assert.equal(verifySignature(body, ts, sig, "other-secret"), false);
});

test("stale timestamps are rejected (replay protection)", () => {
  const body = "{}";
  const old = String(Date.now() - 10 * 60 * 1000);
  assert.equal(verifySignature(body, old, signPayload(body, old, SECRET), SECRET), false);
});

test("matches the verification logic embedded in the n8n Code nodes", () => {
  // n8n receives the parsed JSON body and re-serialises it; JS JSON round-trips are byte-stable.
  const payload = { event: "insights.generated", user: { name: "Ünïcode ✓", email: "a@b.c" }, n: 1.5 };
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const sent = signPayload(body, ts, SECRET);

  const receivedBody = JSON.parse(body); // what $json.body looks like inside n8n
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(`${ts}.${JSON.stringify(receivedBody)}`).digest("hex");
  assert.equal(sent, expected);
});

test("extractBullets turns LLM markdown into plain sentences", () => {
  const md = "- **Revenue** grew 12% in Q3.\n* North region leads with $40k.\n\n1. Returns fell to 2%.\n• Margin is 31%.";
  assert.deepEqual(extractBullets(md), [
    "Revenue grew 12% in Q3.",
    "North region leads with $40k.",
    "Returns fell to 2%.",
    "Margin is 31%.",
  ]);
  assert.deepEqual(extractBullets(null), []);
});

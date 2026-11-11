process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
const test = require("node:test");
const assert = require("node:assert/strict");
const cache = require("../lib/cache");

test("without Redis the cache fails open: loader runs and status is BYPASS", async () => {
  let calls = 0;
  const first = await cache.remember("k", 60, async () => ({ calls: ++calls }));
  const second = await cache.remember("k", 60, async () => ({ calls: ++calls }));
  assert.equal(first.status, "BYPASS");
  assert.equal(JSON.parse(second.json).calls, 2);
});

test("user keys are null (=> bypass) when Redis is unavailable; invalidation is a no-op", async () => {
  assert.equal(await cache.userKey("u1", "summary"), null);
  assert.equal(await cache.invalidateUser("u1"), false);
});

test("hashParams is order-independent and distinguishes values", () => {
  assert.equal(cache.hashParams({ q: "a", page: 1 }), cache.hashParams({ page: 1, q: "a" }));
  assert.notEqual(cache.hashParams({ q: "a" }), cache.hashParams({ q: "b" }));
});

test("loader errors propagate and are not cached", async () => {
  await assert.rejects(cache.remember("err", 60, async () => { throw new Error("not found"); }), /not found/);
});

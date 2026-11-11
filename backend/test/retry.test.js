process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const { backoffDelay, withRetry, isTransientHttpError, withTimeout } = require("../lib/retry");

test("backoff grows exponentially, stays within jitter bounds and is capped", () => {
  for (let i = 0; i < 50; i++) {
    const d1 = backoffDelay(1, { baseMs: 100, jitter: 0.2 });
    const d3 = backoffDelay(3, { baseMs: 100, jitter: 0.2 });
    assert.ok(d1 >= 80 && d1 <= 120, `attempt 1 delay ${d1}`);
    assert.ok(d3 >= 320 && d3 <= 480, `attempt 3 delay ${d3}`);
  }
  assert.ok(backoffDelay(30, { baseMs: 100, maxMs: 1000, jitter: 0 }) === 1000);
});

test("withRetry retries until success", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    },
    { attempts: 5, baseMs: 1, maxMs: 2 }
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withRetry stops immediately on non-retryable errors", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        const err = new Error("bad request");
        err.response = { status: 400 };
        throw err;
      },
      { attempts: 5, baseMs: 1, shouldRetry: isTransientHttpError }
    ),
    /bad request/
  );
  assert.equal(calls, 1);
});

test("transient HTTP classification", () => {
  assert.equal(isTransientHttpError(new Error("ECONNRESET")), true);
  assert.equal(isTransientHttpError({ response: { status: 429 } }), true);
  assert.equal(isTransientHttpError({ response: { status: 503 } }), true);
  assert.equal(isTransientHttpError({ response: { status: 401 } }), false);
});

test("withTimeout rejects slow promises", async () => {
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 200)), 10, "too slow"), /too slow/);
  assert.equal(await withTimeout(Promise.resolve(5), 100), 5);
});

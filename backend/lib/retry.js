/**
 * Retry primitives shared by the event bus, Kafka workers, n8n client and LLM calls.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with +/- jitter so many retrying clients don't synchronise into thundering herds.
 * attempt is 1-based: attempt 1 -> ~baseMs, attempt 2 -> ~baseMs*factor, ... capped at maxMs.
 */
function backoffDelay(attempt, { baseMs = 300, maxMs = 30000, factor = 2, jitter = 0.2 } = {}) {
  const exponential = Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, attempt - 1)));
  const spread = exponential * jitter;
  return Math.max(0, Math.round(exponential - spread + Math.random() * 2 * spread));
}

/**
 * Runs fn(attempt) until it succeeds, `attempts` is exhausted, or shouldRetry(err) returns false.
 */
async function withRetry(fn, { attempts = 3, shouldRetry = () => true, onRetry, ...backoff } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !shouldRetry(err)) throw err;
      const delay = backoffDelay(attempt, backoff);
      if (onRetry) onRetry(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Network errors, timeouts, 408, 429 and 5xx are worth retrying; other 4xx are not. */
function isTransientHttpError(err) {
  if (!err || !err.response) return true;
  const status = err.response.status;
  return status === 408 || status === 429 || status >= 500;
}

/** Rejects if `promise` does not settle within `ms`. The original promise keeps running. */
function withTimeout(promise, ms, message = `Timed out after ${ms}ms`) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { sleep, backoffDelay, withRetry, isTransientHttpError, withTimeout };

/**
 * Outbound n8n webhook client.
 *
 * Every request is signed: X-VizIntel-Signature = "sha256=" + HMAC_SHA256(secret, `${timestamp}.${body}`).
 * The n8n workflows verify the signature and reject timestamps older than 5 minutes (replay protection),
 * so the public webhook URL alone is not enough to trigger emails. An Idempotency-Key header carries the
 * source eventId so n8n (or any receiver) can de-duplicate at-least-once deliveries.
 */
const crypto = require("crypto");
const axios = require("axios");
const { config } = require("../config/env");
const { withRetry, isTransientHttpError } = require("./retry");
const logger = require("./logger").child({ component: "n8n" });

function signPayload(body, timestamp, secret) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function verifySignature(body, timestamp, signature, secret, { toleranceMs = 5 * 60 * 1000, now = Date.now() } = {}) {
  if (!secret || !signature || !timestamp) return false;
  if (Math.abs(now - Number(timestamp)) > toleranceMs) return false;
  const expected = Buffer.from(signPayload(body, timestamp, secret));
  const provided = Buffer.from(String(signature));
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

async function postWebhook(url, payload, { idempotencyKey } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const headers = {
    "Content-Type": "application/json",
    "X-VizIntel-Timestamp": timestamp,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey, "X-VizIntel-Event-Id": idempotencyKey } : {}),
    ...(config.n8n.secret ? { "X-VizIntel-Signature": signPayload(body, timestamp, config.n8n.secret) } : {}),
  };

  return withRetry(
    () => axios.post(url, body, { headers, timeout: config.n8n.timeoutMs, maxRedirects: 0 }),
    {
      attempts: config.n8n.maxAttempts,
      baseMs: 1000,
      shouldRetry: isTransientHttpError,
      onRetry: (err, attempt, delay) =>
        logger.warn({ url, attempt, delay, status: err.response?.status, err: err.message }, "n8n webhook failed; retrying"),
    }
  );
}

module.exports = { signPayload, verifySignature, postWebhook };

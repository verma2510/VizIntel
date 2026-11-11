/**
 * Lightweight, dependency-free interaction tracker. Events are batched in memory and shipped to
 * POST /api/events — the Express producer that publishes them to Kafka.
 *
 *  - flushes every 5s, or as soon as 20 events are queued
 *  - flushes with `keepalive` when the tab is hidden or closed, so the last events aren't lost
 *  - client-generated eventIds make retries idempotent end-to-end (the consumer de-duplicates on them)
 *  - on 429 / 5xx / network errors the batch is re-queued with exponential backoff (bounded queue)
 *  - clicks are captured declaratively: any element with data-track="name" (plus optional
 *    data-track-* attributes as properties) is tracked through one delegated listener
 */
import { API_URL } from "./api";

export type TrackValue = string | number | boolean | null;
export type TrackProperties = Record<string, TrackValue>;
type EventType = "page_view" | "click" | "search";

interface TrackedEvent {
  eventId: string;
  type: EventType;
  occurredAt: string;
  sessionId: string;
  path: string;
  properties: TrackProperties;
}

const ENABLED = import.meta.env.VITE_TRACKING_ENABLED !== "false";
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 20;
const MAX_QUEUE = 500;
const MAX_PROPERTIES = 15;
const SESSION_KEY = "vz_session_id";

let queue: TrackedEvent[] = [];
let flushing = false;
let failures = 0;
let retryAt = 0;
let initialized = false;

const uuid = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // RFC 4122 v4 fallback for non-secure contexts (e.g. the app served over plain http on a LAN IP).
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const sessionId = (() => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = uuid();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return uuid();
  }
})();

const readToken = (): string | null => {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
};

const sanitize = (properties: TrackProperties): TrackProperties =>
  Object.fromEntries(
    Object.entries(properties)
      .slice(0, MAX_PROPERTIES)
      .map(([key, value]) => [key.slice(0, 64), typeof value === "string" ? value.slice(0, 500) : value])
  );

/** Per-browser opt-out, set from Settings → Privacy (lib/prefs.ts). */
const optedOut = (): boolean => {
  try {
    return localStorage.getItem("vz_tracking_optout") === "1";
  } catch {
    return false;
  }
};

export function track(type: EventType, properties: TrackProperties = {}, path = window.location.pathname): void {
  if (!ENABLED || optedOut()) return;
  queue.push({ eventId: uuid(), type, occurredAt: new Date().toISOString(), sessionId, path, properties: sanitize(properties) });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE); // drop the oldest under sustained failure
  if (queue.length >= MAX_BATCH) void flush();
}

export const trackPageView = (path: string) => track("page_view", { title: document.title }, path);
export const trackClick = (target: string, properties: TrackProperties = {}) => track("click", { ...properties, target });
export const trackSearch = (query: string, resultCount: number) => track("search", { query, resultCount });

const send = (events: TrackedEvent[], keepalive: boolean) => {
  const token = readToken();
  return fetch(`${API_URL}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ events }),
    keepalive,
  });
};

const scheduleRetry = (retryAfterHeader: string | null) => {
  failures += 1;
  const retryAfterMs = Number(retryAfterHeader) * 1000;
  const backoffMs = Math.min(60000, 1000 * 2 ** failures);
  retryAt = Date.now() + (Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : backoffMs);
};

export async function flush({ keepalive = false }: { keepalive?: boolean } = {}): Promise<void> {
  if (!ENABLED || flushing || queue.length === 0) return;
  if (!keepalive && Date.now() < retryAt) return;
  flushing = true;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const resp = await send(batch, keepalive);
    if (resp.status === 429 || resp.status >= 500) {
      queue = [...batch, ...queue].slice(-MAX_QUEUE);
      scheduleRetry(resp.headers.get("Retry-After"));
    } else {
      // 202 (accepted) or a 4xx validation error — retrying an invalid event can't succeed, so drop it.
      failures = 0;
      retryAt = 0;
    }
  } catch {
    queue = [...batch, ...queue].slice(-MAX_QUEUE);
    scheduleRetry(null);
  } finally {
    flushing = false;
  }
  if (queue.length >= MAX_BATCH && Date.now() >= retryAt) void flush();
}

/** Page is being hidden/unloaded: ship everything now (keepalive requests outlive the page). */
const flushOnExit = () => {
  if (!ENABLED) return;
  while (queue.length) {
    void send(queue.splice(0, MAX_BATCH), true).catch(() => {});
  }
};

const onDocumentClick = (event: MouseEvent) => {
  const element = (event.target as Element | null)?.closest?.("[data-track]") as HTMLElement | null;
  if (!element) return;
  const properties: TrackProperties = {};
  // data-track-dataset-id="123" -> dataset.trackDatasetId -> { datasetId: "123" }
  for (const [key, value] of Object.entries(element.dataset)) {
    if (key.startsWith("track") && key !== "track" && value !== undefined) {
      properties[key.charAt(5).toLowerCase() + key.slice(6)] = value;
    }
  }
  trackClick(element.dataset.track || "unknown", properties);
};

export function initTracker(): void {
  if (initialized || !ENABLED || typeof window === "undefined") return;
  initialized = true;
  window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  document.addEventListener("click", onDocumentClick, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnExit();
  });
  window.addEventListener("pagehide", flushOnExit);
}

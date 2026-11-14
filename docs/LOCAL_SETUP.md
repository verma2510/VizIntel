# VizIntel — Local Setup & Operations

How to run VizIntel with or without the Kafka / Redis / n8n stack, verify the pipeline, and operate it.
Architecture and design rationale: [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites

- Node.js ≥ 20.19 (22 LTS recommended) — required by Mongoose 9
- Docker Desktop (for options A and B)
- A Groq API key in `AI_API_KEY` (optional — without it the heuristic column classifier and the
  "insights failed / Retry" paths are used)

## Choose how to run it

| Option | What runs where | Use it for |
|---|---|---|
| **A. Full Docker stack** | Everything except the React dev server in Docker | Trying the whole event-driven system |
| **B. Infra in Docker, app on host** | Kafka/Redis/MongoDB/n8n/Mailpit in Docker; API + workers with `npm` | Day-to-day backend development |
| **C. No infrastructure** | API only, MongoDB anywhere | The original setup — still fully supported |

### A. Full Docker stack

```bash
cp .env.example .env              # optional: AI_API_KEY and secrets
docker compose up -d --build      # mongo, redis, kafka, kafka-setup, api, 3 workers, n8n, mailpit
cd frontend && npm install && npm run dev   # http://localhost:5173 (VITE_API_URL=http://localhost:5000)
```

Then set up n8n once (see [n8n setup](#n8n-setup)).

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| API | http://localhost:5000 (`/health`, `/health/ready`) |
| n8n | http://localhost:5678 |
| Mailpit (all emails) | http://localhost:8025 |
| Kafka UI (optional) | `docker compose --profile tools up -d kafka-ui` → http://localhost:8080 |
| MongoDB | `mongodb://localhost:27018/vizintel` (27018 avoids clashing with a local mongod) |

Scale a consumer group: `docker compose up -d --scale activity-worker=3` (≤ 6, the partition count).

### B. Infrastructure in Docker, API and workers on the host

```bash
N8N_VIZINTEL_API_URL=http://host.docker.internal:5000 \
  docker compose up -d mongo redis kafka kafka-setup n8n mailpit
```

`backend/.env` (see `backend/.env.example` for every option):

```dotenv
MONGO_URI=mongodb://localhost:27018/vizintel
JWT_SECRET=dev-jwt-secret-change-me
AI_API_KEY=...
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092
INTERNAL_API_KEY=dev-internal-api-key-change-me
N8N_WEBHOOK_SECRET=dev-webhook-secret-change-me
N8N_WEBHOOK_DATASET_UPLOADED=http://localhost:5678/webhook/vizintel/dataset-uploaded
N8N_WEBHOOK_INSIGHTS_GENERATED=http://localhost:5678/webhook/vizintel/insights-generated
```

```bash
cd backend && npm install
npm run dev          # API with --watch
npm run workers      # all three consumer groups in one process (or worker:activity / worker:notifications / worker:insights)
```

The secrets must match the n8n container's `VIZINTEL_INTERNAL_API_KEY` / `VIZINTEL_WEBHOOK_SECRET`
(both default to the values above via the root `.env`).

### C. Without Kafka, Redis or n8n (original mode)

Only `MONGO_URI` and `JWT_SECRET` are needed. Events are processed in-process ("inline" mode), caching and rate
limiting are bypassed, insights are generated synchronously, notifications are skipped. This is also what an
existing deployment (e.g. Render) gets after `npm install` with no new environment variables.

## n8n setup

One-time, after the `n8n` container is healthy. On **Git Bash for Windows**, prefix `docker compose exec`
commands with `MSYS_NO_PATHCONV=1` (otherwise `/workflows` is rewritten to a Windows path).

1. Open http://localhost:5678 and create the owner account.
2. Import the SMTP credential (points at Mailpit, no auth):
   ```bash
   docker compose exec n8n n8n import:credentials --input=/credentials/smtp-mailpit.json
   ```
   For a real SMTP server, edit the **VizIntel SMTP** credential in the UI instead.
3. Import the workflows — either in the UI (**Workflows → Import from File**, one per file in `n8n/workflows/`)
   or all at once:
   ```bash
   docker compose exec n8n n8n import:workflow --separate --input=/workflows
   ```
4. Open each workflow, **Save** (Ctrl/Cmd+S), then switch it **Active**.
   > n8n 1.12x publishes a *saved version*. Workflows imported via the CLI have no saved version yet, so
   > `n8n update:workflow --active=true` fails with `FOREIGN KEY constraint failed`; saving once in the editor fixes it.
5. Check the webhooks are live — unsigned calls must be rejected:
   ```bash
   curl -X POST http://localhost:5678/webhook/vizintel/dataset-uploaded -H 'Content-Type: application/json' -d '{}'
   # {"accepted":false,"reason":"stale or missing timestamp"}  (HTTP 401)
   ```

Run the scheduled workflows on demand with their manual triggers ("Run Sweep Now", "Send Report Now") or:
```bash
docker compose exec n8n n8n execute --id=vzWeeklyReport01     # weekly report → Mailpit
docker compose exec n8n n8n execute --id=vzInsightsTrigr1     # insight retry sweep
```

The workflows read `VIZINTEL_API_URL`, `VIZINTEL_INTERNAL_API_KEY`, `VIZINTEL_WEBHOOK_SECRET`,
`VIZINTEL_MAIL_FROM`, `VIZINTEL_ADMIN_EMAIL` and `VIZINTEL_APP_URL` from the container environment
(`docker-compose.yml`). The compose file pins n8n 1.123 with `N8N_RUNNERS_ENABLED=false`,
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and `NODE_FUNCTION_ALLOW_BUILTIN=crypto` so the Code nodes can verify HMACs;
on n8n 2.x (mandatory task runners) pass those variables through to the runner.

## Verify the pipeline

```bash
# Health
curl localhost:5000/health/ready            # mongo / redis / kafka.healthy / outbox / cache hit ratio
curl -H 'X-Internal-Api-Key: dev-internal-api-key-change-me' localhost:5000/api/internal/pipeline

# Kafka
cd backend
npm run kafka:lag                           # groups should be Stable, lag ~0
npm run kafka:replay-dlq -- --dry-run       # inspect dead-lettered messages
```

In the app: upload a CSV (it returns immediately; insights show a "generating" state, then appear), search the
sidebar, click datasets and chart bars. Within a few seconds the **Your activity** panel updates (events →
Kafka → aggregator → MongoDB), and Mailpit shows the "dataset processed" and "insights ready" emails.
Repeat a request and check the `X-Cache` header switch from `MISS` to `HIT`.

## Tests

```bash
cd backend
npm test                                                   # unit tests
TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test          # + end-to-end HTTP integration test (throwaway DB, dropped after)
TEST_MONGO_URI=mongodb://127.0.0.1:27017 INSIGHTS_MODE=async npm test
cd ../frontend && npm run build                            # type-check + production build
```

## Operations cheat sheet

| Task | Command |
|---|---|
| Provision / check Kafka topics | `npm run kafka:setup` |
| Consumer group state and lag | `npm run kafka:lag` |
| Replay the DLQ after a fix | `npm run kafka:replay-dlq -- [--topic=<topic>] [--limit=100] [--dry-run]` |
| Backfill legacy datasets (rowCount, insightsStatus) | `npm run db:backfill-stats` |
| Run one worker type | `npm run worker:activity` · `worker:notifications` · `worker:insights` |
| Run several in one process | `WORKERS=activity,insights npm run workers` |

## Deploying beyond localhost

- **API**: `node index.js` (unchanged). Behind Render/NGINX set `TRUST_PROXY=1` so rate limits see client IPs.
  Set `CORS_ORIGIN` to the frontend origin.
- **Workers**: same image/repo, start command `node workers/<name>Consumer.js`; set `WORKER_HEALTH_PORT` for
  liveness probes. Run at least one instance per group.
- **Kafka**: any Kafka-compatible service — set `KAFKA_BROKERS`, `KAFKA_SSL=true`, `KAFKA_SASL_MECHANISM`,
  `KAFKA_SASL_USERNAME`, `KAFKA_SASL_PASSWORD`, and `KAFKA_REPLICATION_FACTOR=3`. Run `npm run kafka:setup` once.
  - **Aiven** signs broker certificates with a private per-project CA, so `KAFKA_SSL=true` alone fails with
    `self signed certificate in certificate chain`. Provide the CA instead: `KAFKA_SSL_CA` (paste the `ca.pem` text)
    or `KAFKA_SSL_CA_FILE` (path, e.g. a Render Secret File at `/etc/secrets/ca.pem`). Either implies TLS.
  - **Aiven free tier** allows 5 topics x 2 partitions: set `KAFKA_SINGLE_ACTIVITY_TOPIC=true`,
    `KAFKA_ACTIVITY_PARTITIONS=2`, `KAFKA_REPLICATION_FACTOR=1`. Topics are not auto-created by the API, so run
    `npm run kafka:setup` once (workers also provision them on boot).
  - The API does **not** consume events. With Kafka on, deploy the worker (`npm run workers`) too, and only then set
    `INSIGHTS_MODE=async`.
- **Redis**: `REDIS_URL` (`rediss://` for TLS).
- **n8n**: set `WEBHOOK_URL` to its public URL, use strong `N8N_ENCRYPTION_KEY` / `INTERNAL_API_KEY` /
  `N8N_WEBHOOK_SECRET`, and move the internal key into an n8n Header Auth credential if preferred.
- Change every `*-change-me` default.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `[config] Missing required configuration: mongo.uri, jwtSecret` | Set `MONGO_URI` and `JWT_SECRET` |
| Activity panel stays at zero | Workers not running (`npm run workers`) or Kafka down — check `/health/ready` → `kafka.healthy` and `npm run kafka:lag` |
| `X-Cache: BYPASS` everywhere | Redis not configured/reachable (`REDIS_URL`) — the app still works |
| Insights stuck on "generating" | In async mode the insights worker must be running; n8n's sweeper re-requests stale ones after `INSIGHTS_STALE_MINUTES` |
| No emails | n8n workflows not active, SMTP credential missing, or `N8N_WEBHOOK_*` not set on the API/workers. `notificationlogs` in MongoDB records each delivery's status and error |
| n8n webhook returns 401 `invalid signature` | `N8N_WEBHOOK_SECRET` (backend) ≠ `VIZINTEL_WEBHOOK_SECRET` (n8n) |
| n8n → API calls fail with 401 | `INTERNAL_API_KEY` (backend) ≠ `VIZINTEL_INTERNAL_API_KEY` (n8n) |
| Port already in use | Override `API_PORT`, `MONGO_PORT`, `REDIS_PORT`, `KAFKA_PORT`, `N8N_PORT`, `MAILPIT_UI_PORT` in the root `.env` |
| `429 Too many requests` | Redis-backed rate limit — tune `RATE_LIMIT_*_PER_MIN` |

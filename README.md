# TraceKit

End-to-end telemetry for Confideleap's backend services and frontends: request, action, job, and workflow IDs, W3C trace context, structured logs, failure stages, async propagation, and headless Faro integration.

Built on OpenTelemetry, Grafana LGTM, Alloy, and Grafana Faro.

> Status: telemetry-only core implemented, benchmarked, and release-ready. No UI, no helpdesk, no request registry.

## Requirements

- Node.js **>= 24**
- The Rust native addon is the **primary** implementation. The TypeScript fallback
exists for unsupported platforms and emergency rollback; it is never silent.
  Set `TRACEKIT_REQUIRE_NATIVE=true` to fail fast when the native binding is missing.

## Identifiers

| ID | Default | Alternate |
|---|---|---|
| Request | `cp_<ULID>` | `cp_<UUIDv7>` |
| Action | `act_<ULID>` | `act_<UUIDv7>` |
| Job | `job_<ULID>` | `job_<UUIDv7>` |
| Workflow | `workflow_<ULID>` | `workflow_<UUIDv7>` |
| Trace | W3C `traceparent` | 32 hex chars |

Legacy `req_<ULID>` inbound IDs are accepted and preserved. Inbound IDs in every supported format are normalized but never rewritten across a trace.

## What works today

- `cp_<ULID>` request IDs generated or preserved from inbound `X-Request-Id`
- Action, job, and workflow IDs with the same switchable body format
- W3C `traceparent`, `tracestate`, and baggage primitives
- Express middleware that attaches context and returns `X-Request-Id` / `X-Trace-Id` / `X-Workflow-Id`
- Structured JSON logs with `request_id`, `trace_id`, `span_id`, `action_id`, `job_id`, `workflow_id`
- Failure stages and services on responses and GraphQL errors
- Downstream failure classification (`database`, `downstream`, `auth.*`, ...)
- Async/job context for BullMQ, outbox rows, crons, and webhooks
- Browser-safe entry with Web Crypto IDs and request-reference capture
- Headless Faro initialization with a runtime-injected collector URL
- Optional OpenTelemetry Node SDK initialization with OTLP export
- Rust core with napi-rs binding and a pure TypeScript fallback

## Quick start

```bash
cd packages/tracekit
npm install
npm run build:native   # optional; falls back to TypeScript when absent
npm run build
npm test
npm run demo           # local two-service end-to-end demo
```

## Backend usage

```ts
import { initTraceKit, createLogger } from '@confideleap-partners/tracekit';
import { requestContext, httpLogger, errorHandler } from '@confideleap-partners/tracekit/express';

// Single bootstrap point: configures IDs and starts OTel.
await initTraceKit({
  service: 'irm-backend',
  idFormat: 'ulid', // or 'uuidv7'; env: TRACEKIT_ID_FORMAT=ulid|uuidv7
  environment: process.env.NODE_ENV,
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const logger = createLogger({ service: 'irm-backend' });

app.use(requestContext());
app.use(httpLogger({ logger }));
app.use(errorHandler({ service: 'irm-backend', logger }));
```

## Async usage

```ts
import { captureJobContext, runWithJobContext } from '@confideleap-partners/tracekit/bullmq';

await queue.add('reconcile', captureJobContext({ tenantId }));
// worker
await runWithJobContext(job.data, async () => {
  // currentContext() restores request, action, job, and workflow IDs
});
```

## Frontend usage

```ts
import { initFaro, initWebTracking, getLastReference } from '@confideleap-partners/tracekit/web';
import { initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

// Runtime env, not build-time secrets.
const env = window.__ENV;

initFaro({
  collectorUrl: env.FARO_COLLECTOR_URL,
  appName: 'irm-frontend',
  environment: env.APP_ENV,
  sdk: { initializeFaro },
  tracing: { TracingInstrumentation },
});

initWebTracking({ app: 'irm-frontend' });

// Apps own the UI; TraceKit only exposes the reference.
const reference = getLastReference();
```

## Sample logs and failure states

Every request emits one JSON object per line. Common fields:

| Field | Meaning |
|---|---|
| `time`, `level`, `service`, `env` | Timestamp, level, service name, environment |
| `request_id`, `trace_id`, `span_id` | Request reference, W3C trace, current span |
| `action_id`, `job_id`, `workflow_id` | Action, async job, workflow correlation |
| `failure_stage`, `failure_service` | Top-level when a failure is recorded |
| `meta.http.request.method`, `meta.http.route`, `meta.http.response.status_code` | Normalized route (no query strings) |
| `meta.duration_ms` | Request duration |
| `meta.failure` | `{ stage, service, operation, status }` |

Response headers on failures: `X-Request-Id`, `X-Trace-Id`, `X-Failure-Stage`, `X-Failure-Service`, `X-Failure-Operation`.

### Success — 200, `info`

```json
{
  "time": "2026-10-19T14:46:38.555Z",
  "level": "info",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YPMH3RP481NJYV5XW5B",
  "trace_id": "b2046a829444b5cbb649d687543d6fb7",
  "span_id": "e4aa222d519c4c13",
  "msg": "request completed",
  "meta": {
    "duration_ms": 5.767,
    "http": { "request": { "method": "GET" }, "response": { "status_code": 200 }, "route": "/ok" }
  }
}
```

### Client errors — `warn`, 4xx

`auth.session` — invalid or expired session

```json
{
  "time": "2026-10-19T14:46:38.569Z",
  "level": "warn",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQ8H2G8KCW65TR22ZAE",
  "trace_id": "1402117943ce7cac83bcded6477810c9",
  "span_id": "acc912dc29ff2e21",
  "failure_stage": "auth.session",
  "failure_service": "irm-backend",
  "msg": "request rejected",
  "meta": {
    "duration_ms": 1.101,
    "failure": { "stage": "auth.session", "service": "irm-backend", "operation": "session.expired" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 401 }, "route": "/fail" }
  }
}
```

`auth.authorization` — PDP/OpenFGA denial

```json
{
  "time": "2026-10-19T14:46:38.571Z",
  "level": "warn",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQBBF9Q6DTFY01HCTFB",
  "trace_id": "9413c9e0e49e256030e25e3c6acb3e83",
  "span_id": "464c21f6565e3a17",
  "failure_stage": "auth.authorization",
  "failure_service": "irm-backend",
  "msg": "request rejected",
  "meta": {
    "duration_ms": 0.562,
    "failure": { "stage": "auth.authorization", "service": "irm-backend", "operation": "pdp.denied" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 403 }, "route": "/fail" }
  }
}
```

`validation.input` — bad input

```json
{
  "time": "2026-10-19T14:46:38.574Z",
  "level": "warn",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQDG81Y0YP0P9TD4WDZ",
  "trace_id": "8b91df5a3550c7cb9e651076e0ce15c5",
  "span_id": "2300af05ecd421a8",
  "failure_stage": "validation.input",
  "failure_service": "irm-backend",
  "msg": "request rejected",
  "meta": {
    "duration_ms": 0.756,
    "failure": { "stage": "validation.input", "service": "irm-backend", "operation": "input.invalid" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 400 }, "route": "/fail" }
  }
}
```

`rate_limit` — throttled

```json
{
  "time": "2026-10-19T14:46:38.577Z",
  "level": "warn",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQG10DS2NFKZR4XXB80",
  "trace_id": "1a14d32a731a2a29844ec6fa6b12fcbe",
  "span_id": "a98f1a835edfca1a",
  "failure_stage": "rate_limit",
  "failure_service": "irm-backend",
  "msg": "request rejected",
  "meta": {
    "duration_ms": 0.526,
    "failure": { "stage": "rate_limit", "service": "irm-backend", "operation": "rate.limit" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 429 }, "route": "/fail" }
  }
}
```

### Server errors — `error`, 5xx

`service.handler` — unclassified handler failure

```json
{
  "time": "2026-10-19T14:46:38.579Z",
  "level": "error",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQJJSACSETS8VH6QFAW",
  "trace_id": "04be708da4d9d8d08615c1564c38e0f2",
  "span_id": "1d0b1c8a480a72ca",
  "failure_stage": "service.handler",
  "failure_service": "irm-backend",
  "msg": "request failed",
  "meta": {
    "duration_ms": 0.859,
    "failure": { "stage": "service.handler", "service": "irm-backend", "operation": "handler.crash" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 500 }, "route": "/fail" }
  }
}
```

`database` — Prisma/Postgres failure

```json
{
  "time": "2026-10-19T14:46:38.581Z",
  "level": "error",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQN528SVWJMV0J3P1R3",
  "trace_id": "9613aa12af7a4a7b0454d49bebf1165c",
  "span_id": "be4959591497e71f",
  "failure_stage": "database",
  "failure_service": "irm-backend",
  "msg": "request failed",
  "meta": {
    "duration_ms": 0.611,
    "failure": { "stage": "database", "service": "irm-backend", "operation": "prisma.query" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 503 }, "route": "/fail" }
  }
}
```

`downstream` — another service failed

```json
{
  "time": "2026-10-19T14:46:38.583Z",
  "level": "error",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQQT6K6SK8ZCANKFVVX",
  "trace_id": "6d968e11be61ca9678750e2294b50443",
  "span_id": "b622d69404359bb3",
  "failure_stage": "downstream",
  "failure_service": "irm-backend",
  "msg": "request failed",
  "meta": {
    "duration_ms": 0.425,
    "failure": { "stage": "downstream", "service": "irm-backend", "operation": "central.pdp" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 502 }, "route": "/fail" }
  }
}
```

`queue.enqueue` — BullMQ enqueue failed

```json
{
  "time": "2026-10-19T14:46:38.585Z",
  "level": "error",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQRDEXZKV8BKEZEV2AK",
  "trace_id": "bcc86dae6413eb5654adc210f169c5ee",
  "span_id": "955c2c62578d751d",
  "failure_stage": "queue.enqueue",
  "failure_service": "irm-backend",
  "msg": "request failed",
  "meta": {
    "duration_ms": 0.485,
    "failure": { "stage": "queue.enqueue", "service": "irm-backend", "operation": "bullmq.add" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 500 }, "route": "/fail" }
  }
}
```

`provider.external` — payment/email/provider failure

```json
{
  "time": "2026-10-19T14:46:38.587Z",
  "level": "error",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQTDY108SJVC9VT604Y",
  "trace_id": "ee653fddf02262eb7c926dd79e56bfe1",
  "span_id": "ca1462e0ce182e99",
  "failure_stage": "provider.external",
  "failure_service": "irm-backend",
  "msg": "request failed",
  "meta": {
    "duration_ms": 0.498,
    "failure": { "stage": "provider.external", "service": "irm-backend", "operation": "razorpay.charge" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 502 }, "route": "/fail" }
  }
}
```

`unknown` — fallback classification

```json
{
  "time": "2026-10-19T14:46:38.589Z",
  "level": "error",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQWS83KKN63VS16G52A",
  "trace_id": "3327c57e3e3d98352a4df9c7ae8a2090",
  "span_id": "030b4727ddca0b38",
  "failure_stage": "unknown",
  "failure_service": "irm-backend",
  "msg": "request failed",
  "meta": {
    "duration_ms": 0.483,
    "failure": { "stage": "unknown", "service": "irm-backend", "operation": "unexpected" },
    "http": { "request": { "method": "GET" }, "response": { "status_code": 500 }, "route": "/fail" }
  }
}
```

### Async — `queue.worker`

Jobs keep the originating request and workflow IDs; `runWithOrCreateJobContext` adds `job_id`.

```json
{
  "time": "2026-10-19T14:46:38.590Z",
  "level": "error",
  "service": "irm-backend",
  "env": "production",
  "request_id": "cp_01M5AA1YQYADEGS2BMCQX7HF3A",
  "trace_id": "d002722d6310e315a8291bb053e511ae",
  "span_id": "389ab3515b719a02",
  "job_id": "job_01M5AA1YQYADEGS2BMCQX7HF3B",
  "action_id": "act_01M5AA1YQYADEGS2BMCQX7HF3C",
  "action_name": "renewal-scan",
  "workflow_id": "workflow_01M5AA1YQYADEGS2BMCQX7HF3D",
  "msg": "job failed",
  "meta": {
    "failure": { "stage": "queue.worker", "service": "worker", "operation": "renewal.scan" }
  }
}
```

### Browser — `client.network`, `client.render`, `client.api`

Browser states have no server log. `getLastReference()` returns the reference the app can display or report:

```json
{
  "app": "irm-frontend",
  "route": "/investors",
  "at": "2026-10-19T14:46:38.591Z",
  "failureStage": "client.network"
}
```

- `client.network` — no HTTP response (offline, DNS, TLS)
- `client.render` — React error boundary / render crash
- `client.api` — server error without a stage header
- `edge.proxy` — set by Nginx/Traefik for 502/504 before the app; the client sees `X-Failure-Stage: edge.proxy`

### Stage reference

| Stage | Detected at | Typical status | Log level | Log message |
|---|---|---|---|---|
| `client.network` | Browser | — | — | WebReference only |
| `client.render` | Browser | — | — | WebReference only |
| `client.api` | Browser | — | — | WebReference only |
| `edge.proxy` | Nginx/Traefik | 502/504 | — | Proxy access log |
| `auth.session` | Service auth | 401 | warn | `request rejected` |
| `auth.authorization` | PDP/OpenFGA | 403 | warn | `request rejected` |
| `validation.input` | Input validation | 400/422 | warn | `request rejected` |
| `rate_limit` | Rate limiter | 429 | warn | `request rejected` |
| `service.handler` | Handler | 500 | error | `request failed` |
| `database` | Prisma/Postgres | 503 | error | `request failed` |
| `downstream` | Service call | 502 | error | `request failed` |
| `queue.enqueue` | BullMQ add | 500 | error | `request failed` |
| `queue.worker` | Worker/outbox | — | error | `job failed` |
| `provider.external` | Payment/email/provider | 502 | error | `request failed` |
| `unknown` | Fallback | 500 | error | `request failed` |

Regenerate all of the above with `npm run stages` (or the full walkthrough with `npm run sample`).

## Package subpaths

- `@confideleap-partners/tracekit` — context, fetch, logger, OTel, async
- `@confideleap-partners/tracekit/express`
- `@confideleap-partners/tracekit/apollo`
- `@confideleap-partners/tracekit/next`
- `@confideleap-partners/tracekit/web` — browser-safe entry + headless Faro
- `@confideleap-partners/tracekit/bullmq`
- `@confideleap-partners/tracekit/testing`

## Benchmarks

Measured on Node 24 (Intel i5-10210U, 8 threads): native ID generation at
~3.15M request IDs/s, single-process HTTP capacity at ~5,100 RPS with context +
logging (conservative, in-process load generator), and the 2.8k RPS
one-hour-replay target sustained with zero errors.

See [bench/RESULTS.md](packages/tracekit/bench/RESULTS.md).

## Documentation

- [API reference](docs/API.md)
- [Agent integration guide](AGENTS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Release guide](RELEASE.md)

## Non-goals

- A request registry or telemetry database.
- A custom trace viewer; Grafana is the support UI.
- UI components, support modals, or helpdesk integration.
- User-facing business workflow status pages.

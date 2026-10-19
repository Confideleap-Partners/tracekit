# TraceKit Implementation Plan

Last updated: 2026-10-19
Status: telemetry-only core implemented, benchmarked, and release-ready; service integration pending
Owner: Platform / Observability

---

## 1. Summary

TraceKit is an end-to-end telemetry SDK for Confideleap's backend services and frontends. It combines:

- a Rust core for IDs, W3C trace context, baggage, and redaction;
- TypeScript facades for Express, Apollo, Next.js, BullMQ, and browsers;
- OpenTelemetry traces exported to Tempo through Alloy;
- structured JSON logs exported to Loki;
- headless Grafana Faro integration for browser telemetry;
- Grafana Request Lookup for support debugging.

It is telemetry-only. It is not a request registry, UI, helpdesk integration, or business workflow store.

---

## 2. Locked decisions

| Item | Decision |
|---|---|
| npm package | `@confideleap/tracekit`, public npm |
| Default request ID | `cp_<ULID>` |
| Alternate request ID | `cp_<UUIDv7>` |
| Action ID | `act_<ULID>` / `act_<UUIDv7>` |
| Job ID | `job_<ULID>` / `job_<UUIDv7>` |
| Workflow ID | `workflow_<ULID>` / `workflow_<UUIDv7>` |
| Legacy inbound | `req_<ULID>` accepted and preserved |
| Scope | Telemetry only; no UI, no helpdesk |
| Browser | Browser-safe entry + headless Faro |
| Faro collector URL | Runtime environment configuration, injected by the app |
| Consumers | All backend services and all frontends |
| Volume | 10M requests/day (~116 RPS average, ~1.2k RPS peak design) |
| Retention | 4 weeks / 28 days for telemetry |

---

## 3. Identifier and header contract

### 3.1 Identifiers

| Identifier | Format | Purpose |
|---|---|---|
| `request_id` | `cp_<ULID>` or `cp_<UUIDv7>` | Human/support correlation for one HTTP request |
| `trace_id` / `span_id` | W3C `traceparent` | Distributed trace |
| `action_id` | `act_<ULID>` or `act_<UUIDv7>` | One user action spanning multiple calls |
| `job_id` | `job_<ULID>` or `job_<UUIDv7>` | Cron/async work without an originating request |
| `workflow_id` | `workflow_<ULID>` or `workflow_<UUIDv7>` | Durable business workflow/saga |
| `idempotency_key` | Existing header | Mutation replay identity |

### 3.2 Propagation headers

Request and response:

```
traceparent: 00-<32 hex trace-id>-<16 hex span-id>-<2 hex flags>
tracestate: <vendor state>
baggage: <bounded key/value pairs>
X-Request-Id: cp_<ULID> (or cp_<UUIDv7>)
X-Action-Id: act_<...>
X-Workflow-Id: workflow_<...>
```

Response only:

```
X-Trace-Id: <32 hex trace-id>
X-Failure-Stage: <stage, errors only>
X-Failure-Service: <service, errors only>
```

Rules:

- Accept a valid inbound ID; otherwise generate one.
- Never overwrite a valid inbound ID.
- Accept `cp_<ULID>`, `cp_<UUIDv7>`, and legacy `req_<ULID>`.
- Validate trace headers and baggage limits.
- Echo `X-Request-Id` on every response.
- Expose the headers through CORS on every API.
- Never use IDs as authentication tokens or metric labels.

### 3.3 Log fields

Every request-related log line includes `request_id`, `trace_id`, `span_id`, and — when present — `action_id`, `job_id`, `workflow_id`, `tenant_id`, `user_id`, `failure_stage`, `failure_service`, `http.route`, `http.response.status_code`, and `duration_ms`.

---

## 4. Architecture

```
Browser / frontend
  │  Web Crypto IDs, fetch capture, headless Faro (runtime collector URL)
  ▼
Nginx / Traefik
  │  access logs -> Alloy -> Loki
  ▼
Backend service
  │  cp_<ULID> request context, OTel trace, structured logs
  ├──► downstream services       traceparent + IDs propagated
  ├──► Postgres / Redis          instrumented
  └──► BullMQ / outbox / crons   context persisted in job payload/row
  ▼
Response headers: X-Request-Id, X-Trace-Id, X-Workflow-Id, X-Failure-*
  ▼
JSON logs -> Alloy -> Loki
Spans -> Alloy -> Tempo
Browser events -> Faro receiver -> Tempo/Loki
Grafana Request Lookup
```

---

## 5. Package

```
tracekit/
├── crates/
│   ├── core/                 # pure Rust core
│   └── node/                 # napi-rs binding
├── packages/tracekit/
│   ├── src/
│   │   ├── browser-core.ts   # browser-safe Web Crypto IDs and validation
│   │   ├── web.ts            # headless fetch capture + Faro
│   │   ├── ids.ts            # format configuration and generators
│   │   ├── context.ts        # AsyncLocalStorage + propagation
│   │   ├── fetch.ts          # traced fetch + failure capture
│   │   ├── logger.ts         # JSON logger + redaction
│   │   ├── otel.ts           # NodeSDK + OTLP
│   │   ├── express.ts        # middleware
│   │   ├── apollo.ts         # GraphQL error extensions
│   │   ├── next.ts           # Next.js helpers
│   │   ├── bullmq.ts         # async context
│   │   ├── bootstrap.ts      # initTraceKit
│   │   └── testing.ts        # test helpers
│   ├── examples/local-e2e.js
│   └── README.md
├── LICENSE
├── scripts/build-native.sh
└── docs/IMPLEMENTATION_PLAN.md
```

Subpaths: `.`, `./express`, `./apollo`, `./next`, `./web`, `./bullmq`, `./testing`.

The browser entry must not import Node built-ins. CI bundles it and fails if it does.

---

## 6. Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `TELEMETRY_ENABLED` | all services | Kill switch |
| `TRACEKIT_ID_FORMAT` | all services | `ulid` (default) or `uuidv7` |
| `OTEL_SERVICE_NAME` | Node/Next | Service identity |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Node/Next | Alloy/Collector endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Node/Next | `http/protobuf` |
| `OTEL_RESOURCE_ATTRIBUTES` | Node/Next | namespace, environment, version |
| `TELEMETRY_SAMPLE_RATIO` | Node/Next | Trace sampling |
| `TELEMETRY_RETENTION_DAYS=28` | services/dashboards | Retention contract |
| `TRACEKIT_REQUIRE_NATIVE` | Node services | `true` fails fast when the native binding is unavailable |
| `FARO_COLLECTOR_URL` | frontends (runtime) | Faro receiver URL, injected by the app |
| `FARO_APP_NAME` | frontends (runtime) | App identity |
| `GRAFANA_REQUEST_LOOKUP_URL` | docs/tickets | Optional deep link |

Tempo/Loki/Mimir sizing is deployment configuration, not a runtime env var.

---

## 7. Production roadmap

### P0 — release blockers

Benchmarked on Node 24: native ID generation ~3.15M request IDs/s, single-process
HTTP capacity ~5,100 RPS with context + logging, 2.8k RPS replay target with zero
errors. See `bench/RESULTS.md`.

1. **Native distribution**: napi-rs prebuilds as platform packages for linux gnu/musl x64/arm64 and macOS, optionalDependencies, loader resolution, JS fallback.
2. **Browser distribution**: dual CJS/ESM build, `browser` export condition, no Node built-ins, bundle-size budget.
3. **Package metadata**: package README, LICENSE, repository, sideEffects, publishConfig public, OTel optional peers.
4. **CI/CD**: Node 20/22/24, Alpine, cargo fmt/clippy/test/audit, TS build/tests, browser-bundle check, npm pack smoke test, provenance publish.
5. **Service integration**: central-backend, irm-backend, login, frontend, irm-frontend; CORS exposed headers; PDP propagation; Next instrumentation/proxy.
6. **Telemetry pipeline**: Alloy OTLP + Faro receiver, Tempo/Loki/Mimir, Grafana correlations, Request Lookup dashboard, 28-day retention, alerts.

### P1 — hardening

1. **Inbound trust model**: `trustInboundTraceContext` / `trustInboundRequestId` options; public ingress generates a fresh trace and links the client trace.
2. **Propagation completeness**: baggage/tracestate propagation with limits; workflow ID on every hop.
3. **OTel depth**: fallback inbound span when auto-instrumentation is absent; span status/exception recording; graceful shutdown; exporter headers/TLS; drop metrics.
4. **Logger safety**: cycle/depth/size-safe serializer; message and header redaction; optional pino adapter.
5. **Async correctness**: real Redis/BullMQ/outbox tests; OTel links on retries and dead letters; webhook-to-original links.
6. **Security/supply chain**: cargo audit/deny, CodeQL, secret scanning, SBOM, provenance, native fuzz tests.
7. **Scale**: native-vs-fallback benchmark, p99 overhead, 10M/day replay, browser budget, collector-down chaos.

### P2 — operations

1. Grafana Request Lookup with `$request_id`, ULID/UUIDv7 timestamp windowing, 28-day retention note.
2. Alerts: 5xx ratio, p95/p99 latency, telemetry drops, missing `request_id`, trace/log correlation gaps.
3. Docs: integration guide for central/irm/login/frontends, migration from `req_` to `cp_`, environment matrix, troubleshooting runbook.
4. Versioning: changesets, CHANGELOG, deprecation policy, OTel compatibility matrix.

---

## 8. Testing and acceptance

- Contract tests for every ID format, traceparent, baggage, and redaction.
- Two-service end-to-end test: request/trace/workflow IDs shared across services and async work; downstream failure stage propagation; OTel span export.
- Browser-core tests: Web Crypto, uniqueness, normalization.
- Later: real BullMQ/Redis integration, collector-down chaos, 10M/day replay, Next standalone, Alpine containers.
- Definition of done: installs on Node 20/22/24 + Alpine + browsers; every response carries IDs; logs/traces correlate; collector outage is transparent; 28-day retention enforced; no UI/helpdesk code ships; public npm release with provenance.

---

## 9. Open items

1. **npm org**: the current npm token is invalid; run `npm login` and confirm `@confideleap` publish permissions and 2FA.
2. **Faro ownership**: who owns the Faro receiver/Alloy configuration and the runtime env values.
3. **Integration order**: central-backend + irm-backend + login first, or all services together.
4. **Public history**: the history is telemetry-only and includes the finalization commits. Push once the GitHub remote and npm access are ready.

# TraceKit

End-to-end telemetry for Confideleap's backend services and frontends: request, action, job, and workflow IDs, W3C trace context, structured logs, failure stages, async propagation, and headless Faro integration.

Built on OpenTelemetry, Grafana LGTM, Alloy, and Grafana Faro.

> Status: telemetry-only core implemented and tested. No UI, no helpdesk, no request registry.

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
import { initTraceKit, createLogger } from '@confideleap/tracekit';
import { requestContext, httpLogger, errorHandler } from '@confideleap/tracekit/express';

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
import { captureJobContext, runWithJobContext } from '@confideleap/tracekit/bullmq';

await queue.add('reconcile', captureJobContext({ tenantId }));
// worker
await runWithJobContext(job.data, async () => {
  // currentContext() restores request, action, job, and workflow IDs
});
```

## Frontend usage

```ts
import { initFaro, initWebTracking, getLastReference } from '@confideleap/tracekit/web';
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

## Package subpaths

- `@confideleap/tracekit` — context, fetch, logger, OTel, async
- `@confideleap/tracekit/express`
- `@confideleap/tracekit/apollo`
- `@confideleap/tracekit/next`
- `@confideleap/tracekit/web` — browser-safe entry + headless Faro
- `@confideleap/tracekit/bullmq`
- `@confideleap/tracekit/testing`

## Documentation

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)

## Non-goals

- A request registry or telemetry database.
- A custom trace viewer; Grafana is the support UI.
- UI components, support modals, or helpdesk integration.
- User-facing business workflow status pages.

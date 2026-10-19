# TraceKit — Agent Integration Guide

Telemetry-only SDK. Node `>=24`. Rust native core is primary; TS fallback is secondary and warns.

```
npm i @confideleap-partners/tracekit
```

IDs: request `cp_<ULID>` (switch `cp_<UUIDv7>`), action `act_*`, job `job_*`, workflow `workflow_*`.
Legacy `req_<ULID>` accepted inbound. Headers: `X-Request-Id`, `X-Trace-Id`, `X-Action-Id`, `X-Workflow-Id`, `X-Failure-Stage`, `X-Failure-Service`, `traceparent`.

## Backend (Express)

Call bootstrap **before importing express or instrumented libs**:

```ts
// telemetry.ts — import this first in server.ts
import { initTraceKit } from '@confideleap-partners/tracekit';

await initTraceKit({
  service: 'irm-backend',
  idFormat: 'ulid', // or 'uuidv7'
  environment: process.env.NODE_ENV,
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  sampleRatio: Number(process.env.TELEMETRY_SAMPLE_RATIO ?? 0.2),
});
```

```ts
import { createLogger } from '@confideleap-partners/tracekit';
import { requestContext, httpLogger, errorHandler } from '@confideleap-partners/tracekit/express';

const logger = createLogger({ service: 'irm-backend' });
app.use(requestContext());          // before rate limiters/routes
app.use(httpLogger({ logger }));
app.use('/api', routes);
app.use(errorHandler({ service: 'irm-backend', logger }));
```

CORS: expose `X-Request-Id`, `X-Trace-Id`, `X-Action-Id`, `X-Workflow-Id`, `X-Failure-Stage`, `X-Failure-Service`, `Server-Timing`.

Downstream calls and auth context:

```ts
import { tracedFetch, injectTraceHeaders, getResponseFailure } from '@confideleap-partners/tracekit';

const res = await tracedFetch(`${AUTH_URL}/api/auth/authorize`, { method: 'POST', headers: injectTraceHeaders({ cookie }), body });
const failure = getResponseFailure(res); // { stage, service, operation, status }
```

After auth, enrich logs: `updateContext({ tenantId, userId })` from `@confideleap-partners/tracekit`.

## Async (BullMQ / outbox / crons)

```ts
import { captureJobContext, runWithJobContext, createJobContext } from '@confideleap-partners/tracekit/bullmq';

await queue.add('reconcile', captureJobContext({ tenantId }));   // producer
await runWithJobContext(job.data, async () => { /* consumer */ });
createJobContext('renewal-scan');                                 // crons/webhooks
```

Persist `tracekit` context in outbox rows / job data; never drop it on retry.

## GraphQL (Apollo)

```ts
import { tracekitApolloPlugin } from '@confideleap-partners/tracekit/apollo';
new ApolloServer({ plugins: [tracekitApolloPlugin()] });
```

## Next.js

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initTraceKit } = await import('@confideleap-partners/tracekit');
    await initTraceKit({ service: 'login', otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT });
  }
}
```

Route handlers: `withNextRequestContext(request.headers, async (ctx) => ...)`; proxy/forward: `forwardedRequestHeaders(headers)` from `@confideleap-partners/tracekit/next`.
Next standalone: add native package to `serverExternalPackages` (fallback still works).

## Frontend (browser, no UI)

```ts
import { initFaro, initWebTracking, getLastReference, recordWebReference } from '@confideleap-partners/tracekit/web';
import { initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

const env = window.__ENV; // runtime env, not build-time secrets
initFaro({ collectorUrl: env.FARO_COLLECTOR_URL, appName: 'irm-frontend', environment: env.APP_ENV, sdk: { initializeFaro }, tracing: { TracingInstrumentation } });
initWebTracking({ app: 'irm-frontend' }); // wraps fetch, captures X-Request-Id/X-Trace-Id/X-Workflow-Id
```

Axios uses XHR: add a response interceptor that calls `recordWebReference({ requestId: res.headers['x-request-id'], traceId: res.headers['x-trace-id'], failureStage: res.headers['x-failure-stage'] })`. Faro handles XHR spans.
Apps own all UI; expose `getLastReference()` in error messages.

## Env vars

`TELEMETRY_ENABLED` · `TRACEKIT_ID_FORMAT=ulid|uuidv7` · `TRACEKIT_REQUIRE_NATIVE=true` (fail fast) · `OTEL_SERVICE_NAME` · `OTEL_EXPORTER_OTLP_ENDPOINT` · `OTEL_RESOURCE_ATTRIBUTES` · `TELEMETRY_SAMPLE_RATIO` · `FARO_COLLECTOR_URL` (runtime).

## Verify

1. Every response has `X-Request-Id`; errors have `X-Failure-Stage`/`X-Failure-Service`.
2. Response IDs equal `request_id`/`trace_id`/`workflow_id` in service logs.
3. Downstream calls carry the same `traceparent` + `X-Request-Id`; failures keep the originating stage.
4. Async work logs the same `request_id` and `workflow_id`.
5. In the package repo: `npm test`, `npm run test:native`, `npm run demo`.

## Full API

See [docs/API.md](docs/API.md) for every public export.

## Rules

- Do: init once before imports; propagate with `tracedFetch`/`injectTraceHeaders`; keep IDs in logs and job payloads.
- Don't: log tokens/cookies/bodies, derive tenant/user from untrusted headers or baggage, use IDs as metric labels, or build a request registry.

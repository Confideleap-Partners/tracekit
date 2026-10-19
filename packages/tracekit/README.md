# @confideleap-partners/tracekit

End-to-end telemetry for backend services and frontends: request, action, job, and workflow IDs, W3C trace context, structured logs, failure stages, async propagation, and headless Faro integration.

- Default request ID: `cp_<ULID>`
- Alternate: `cp_<UUIDv7>`
- Action/job/workflow: `act_`, `job_`, `workflow_` with the same switchable body
- Legacy `req_<ULID>` inbound IDs accepted
- No UI, no helpdesk, no request registry
- Node.js **>= 24**
- Rust native addon is primary; TypeScript fallback is secondary and warns once

## Install

```bash
npm install @confideleap-partners/tracekit
```

Optional peers when using OpenTelemetry export:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/sdk-trace-base
```

Optional peers when using browser RUM: install `@grafana/faro-web-sdk` and `@grafana/faro-web-tracing` in the frontend app and pass them to `initFaro`.

## Backend

```ts
import { initTraceKit, createLogger } from '@confideleap-partners/tracekit';
import { requestContext, httpLogger, errorHandler } from '@confideleap-partners/tracekit/express';

await initTraceKit({
  service: 'irm-backend',
  idFormat: 'ulid', // or 'uuidv7'
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const logger = createLogger({ service: 'irm-backend' });
app.use(requestContext());
app.use(httpLogger({ logger }));
app.use(errorHandler({ service: 'irm-backend', logger }));
```

## Frontend

```ts
import { initFaro, initWebTracking, getLastReference } from '@confideleap-partners/tracekit/web';
import { initializeFaro } from '@grafana/faro-web-sdk';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';

initFaro({
  collectorUrl: window.__ENV.FARO_COLLECTOR_URL,
  appName: 'irm-frontend',
  environment: window.__ENV.APP_ENV,
  sdk: { initializeFaro },
  tracing: { TracingInstrumentation },
});

initWebTracking({ app: 'irm-frontend' });
```

## Performance

Native ID generation: ~3.15M request IDs/s. Single-process HTTP capacity:
~5,100 RPS with request context + logging (conservative in-process benchmark).
See `bench/RESULTS.md`.

## License

MIT

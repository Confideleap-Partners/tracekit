# TraceKit API Reference

Complete reference for every public API exposed by `@confideleap/tracekit`.

- Node.js `>= 24`
- Rust native core is primary; TypeScript fallback is secondary and warns once
- Telemetry only: no UI, no helpdesk, no request registry

## Package entry points

| Import path | Contents |
|---|---|
| `@confideleap/tracekit` | Bootstrap, IDs, context, failure, fetch, logger, OTel, async, Express helpers, types |
| `@confideleap/tracekit/express` | Express middleware + Express-specific types |
| `@confideleap/tracekit/apollo` | Apollo Server plugin |
| `@confideleap/tracekit/next` | Next.js helpers |
| `@confideleap/tracekit/web` | Browser-safe entry: fetch capture + headless Faro |
| `@confideleap/tracekit/bullmq` | Async/job context helpers |
| `@confideleap/tracekit/testing` | Test helpers |

---

## 1. Types (`@confideleap/tracekit`)

### `IdFormat`

```ts
type IdFormat = 'ulid' | 'uuidv7';
```

Generated ID body format. Default is `'ulid'`.

### `FailureStage`

```ts
type FailureStage =
  | 'client.network' | 'client.render' | 'client.api'
  | 'edge.proxy'
  | 'auth.session' | 'auth.authorization'
  | 'validation.input' | 'rate_limit'
  | 'service.handler' | 'database' | 'downstream'
  | 'queue.enqueue' | 'queue.worker' | 'provider.external'
  | 'unknown';
```

### `FailureInfo`

| Field | Type | Description |
|---|---|---|
| `stage` | `FailureStage` | Where the request failed |
| `service` | `string?` | Service where it failed |
| `operation` | `string?` | Handler/operation name |
| `status` | `number?` | HTTP status |
| `errorCode` | `string?` | Sanitized error code |
| `message` | `string?` | Sanitized message |

### `TraceContext`

| Field | Type | Description |
|---|---|---|
| `requestId` | `string` | `cp_<ULID>` / `cp_<UUIDv7>` / legacy `req_<ULID>` |
| `traceId` | `string` | 32 hex chars |
| `spanId` | `string` | 16 hex chars |
| `traceparent` | `string` | W3C header value |
| `actionId` | `string?` | `act_*` |
| `actionName` | `string?` | Human label for the action |
| `jobId` | `string?` | `job_*` |
| `workflowId` | `string?` | `workflow_*` |
| `tenantId` | `string?` | Set after auth via `updateContext` |
| `userId` | `string?` | Set after auth via `updateContext` |
| `failureStage` | `FailureStage?` | Recorded by `recordFailure` |
| `failureService` | `string?` | Recorded by `recordFailure` |
| `service` | `string?` | Optional service name |
| `env` | `string?` | Optional environment |

### `TraceParent`

```ts
interface TraceParent { traceId: string; spanId: string; flags: number; }
```

### `BaggageItem`

```ts
interface BaggageItem { key: string; value: string; }
```

### `HeaderLike`

```ts
interface HeaderLike { [key: string]: string | string[] | number | undefined; }
```

---

## 2. Bootstrap

### `initTraceKit(options)`

Configures the ID format and starts OpenTelemetry in one call. Call once at process start, before importing instrumented libraries.

```ts
await initTraceKit({
  service: 'irm-backend',
  idFormat: 'ulid',
  environment: process.env.NODE_ENV,
  serviceVersion: process.env.GIT_SHA,
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  sampleRatio: 0.2,
});
```

`InitTraceKitOptions` = `TelemetryOptions & TraceKitConfig` (see sections 7 and 3).

Returns `Promise<TelemetryInitResult>`: `{ enabled: boolean; reason?: string }`.

---

## 3. ID configuration and generation

### `configureTraceKit(config)`

```ts
configureTraceKit({ idFormat: 'uuidv7' });
```

Sets the process-global ID format. Inbound IDs in any supported format are still accepted.

### `getIdFormat()`

Returns the active `IdFormat`. Reads `TRACEKIT_ID_FORMAT` once unless configured.

### `isValidIdFormat(value)`

Type guard: `value is IdFormat`.

### `resetTraceKitConfig()`

Restores `'ulid'` and re-reads the environment variable on next access.

### `DEFAULT_ID_FORMAT`

```ts
const DEFAULT_ID_FORMAT: IdFormat = 'ulid';
```

### `generateRequestId(format?)` → `cp_<body>`

### `generateActionId(format?)` → `act_<body>`

### `generateJobId(format?)` → `job_<body>`

### `generateWorkflowId(format?)` → `workflow_<body>`

`format` defaults to `getIdFormat()`. Body is ULID or UUIDv7 depending on the format.

### `TraceKitConfig`

```ts
interface TraceKitConfig { idFormat?: IdFormat; }
```

---

## 4. Native core access

### `core()`

Returns the native binding (`NativeApi`) when available, otherwise the TypeScript fallback. This is the primary implementation accessor.

### `isNativeAvailable()`

`boolean`. True when the native addon loaded.

### `getNativeStatus()`

```ts
interface NativeStatus {
  available: boolean;
  loadedFrom: string | null;
  fallbackReason: string | null;
  platform: string;
  arch: string;
  libc: 'musl' | 'glibc' | 'unknown';
}
```

### `jsFallback`

The full `NativeApi` implemented in TypeScript. Useful for tests and diagnostics.

### `NativeApi` methods

| Method | Returns | Description |
|---|---|---|
| `newUlid()` | `string` | 26-char Crockford ULID |
| `newUuidv7()` | `string` | Canonical UUIDv7 |
| `isValidUuidv7(value)` | `boolean` | Version 7 + RFC variant check |
| `newRequestId()` | `string` | `cp_<ULID>` |
| `newActionId()` | `string` | `act_<ULID>` |
| `newJobId()` | `string` | `job_<ULID>` |
| `newWorkflowId()` | `string` | `workflow_<ULID>` |
| `newTraceId()` | `string` | 32 hex chars, non-zero |
| `newSpanId()` | `string` | 16 hex chars, non-zero |
| `isValidUlid(value)` | `boolean` | ULID validation |
| `isValidRequestId(value)` | `boolean` | Any supported request ID format |
| `normalizeRequestId(value)` | `string \| null` | Canonical `cp_*` / legacy `req_*` |
| `normalizeActionId(value)` | `string \| null` | Canonical `act_*` |
| `normalizeJobId(value)` | `string \| null` | Canonical `job_*` |
| `normalizeWorkflowId(value)` | `string \| null` | Canonical `workflow_*` |
| `parseTraceparent(value)` | `TraceParent \| null` | W3C parse + validate |
| `formatTraceparent(traceId, spanId, flags)` | `string \| null` | W3C format |
| `isValidTracestate(value)` | `boolean` | Limits: 32 members, 512 bytes |
| `sanitizeHeaderValue(value)` | `string \| null` | Strips control chars, caps 1024 bytes |
| `parseBaggage(value)` | `BaggageItem[]` | Limits: 180 members, 8192 bytes |
| `formatBaggage(items)` | `string \| null` | Percent-encoded, limit-checked |
| `shouldSample(traceId, ratio)` | `boolean` | Deterministic trace-id sampling |
| `redactJson(json, extraKeys?)` | `string \| null` | Key-based redaction + truncation |

Native loading order: `native/tracekit.node` → `tracekit.<platform-tag>.node` → `@confideleap/tracekit-<platform-tag>`. `TRACEKIT_REQUIRE_NATIVE=true` throws when none load.

---

## 5. Request context

### `createContextFromHeaders(headers?, options?)`

```ts
createContextFromHeaders(
  headers?: HeaderLike | Headers,
  options?: { generateMissing?: boolean; idFormat?: IdFormat },
): TraceContext
```

Reads `x-request-id`, `x-action-id`, `x-workflow-id`, `traceparent`. Precedence for trace: active OTel span → inbound traceparent → generated.

### `runWithContext(context, fn)`

Runs `fn` inside the context via `AsyncLocalStorage`. Returns `fn`'s result.

### `currentContext()`

Active `TraceContext` or `undefined`.

### `requireContext()`

Active `TraceContext`; throws `TraceKit: no active request context` when absent.

### `updateContext(patch)`

Merges fields into the active context (for example `{ tenantId, userId }` after auth). Returns the context or `undefined`.

### `contextToLogFields(context)`

Maps context to snake_case log fields: `request_id`, `trace_id`, `span_id`, `action_id`, `action_name`, `job_id`, `workflow_id`, `tenant_id`, `user_id`, `failure_stage`, `failure_service`.

### `currentTraceparent(context?)`

Current W3C traceparent, preferring the active OTel span; generates one if none exists.

### `injectTraceHeaders(headers?, context?)`

Returns a copy of the headers with `traceparent`, `x-request-id`, `x-action-id`, and `x-workflow-id` injected from the active context.

### `toHeaderLike(input)`

Normalizes `Headers`, Node request headers, or a plain object to `HeaderLike`.

---

## 6. Failure handling

### `classifyStatus(status)`

Maps an HTTP status to a `FailureStage` (401→`auth.session`, 403→`auth.authorization`, 400/422→`validation.input`, 429→`rate_limit`, 5xx→`service.handler`).

### `classifyError(err)`

Returns a `FailureInfo`. Reuses metadata attached by `markFailure`; recognizes Prisma/PG codes as `database` and network/timeout codes as `downstream`.

### `markFailure(err, info)`

Attaches `FailureInfo` to an error (non-enumerable) and returns it.

### `getFailure(err)`

Returns attached `FailureInfo` or `undefined`.

### `failureFromHeaders(headers)`

Reads `x-failure-stage`, `x-failure-service`, `x-failure-operation`, `x-failure-code` from a response (plain object or `Headers`).

### `setFailureHeaders(res, info)`

Sets `X-Failure-Stage`, `X-Failure-Service`, `X-Failure-Operation`, `X-Failure-Code` on an Express-like response.

### `recordFailure(info)`

Writes `failureStage`/`failureService` into the active context so logs pick them up.

### `contextFailure(context)`

Returns `{ stage, service }` from a context when a failure was recorded.

---

## 7. Fetch instrumentation

### `tracedFetch(input, init?, options?)`

```ts
tracedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { serviceName?: string; spanName?: string; propagate?: boolean },
): Promise<Response>
```

- Propagates `traceparent` and IDs to the downstream call
- Creates a client span when OTel is available
- Records `downstream` failures; uses downstream `X-Failure-*` headers when present
- `propagate: false` disables header injection

### `getResponseFailure(response)`

Returns the `FailureInfo` recorded for a 4xx/5xx response, or `undefined`.

### `TracedFetchOptions`

```ts
interface TracedFetchOptions {
  serviceName?: string;
  spanName?: string;
  propagate?: boolean;
}
```

---

## 8. Logger

### `createLogger(options)`

```ts
interface LoggerOptions {
  service: string;
  env?: string;              // defaults to NODE_ENV
  version?: string;
  level?: LogLevel;          // default 'info'
  redactKeys?: string[];     // extra keys to redact
  sink?: (line: string, record: Record<string, unknown>) => void;
}
```

Returns a `Logger`:

| Method | Description |
|---|---|
| `debug/info/warn/error(msg, meta?)` | Writes JSON with context fields and redacted meta |
| `child(bindings)` | Returns a logger with extra bindings |
| `options` | The resolved options |

Redaction covers authorization, cookies, tokens, passwords, API keys, OTP/MFA, card data, plus `redactKeys`. JSON meta is parsed and re-serialized; errors are serialized with `name`, `message`, and `stack` (non-production).

### `httpLogger(options)`

```ts
httpLogger({ logger, includeRoute?: boolean })
```

Express middleware that logs one JSON line per request on `finish`:

- `http.request.method`, `http.route`, `http.response.status_code`, `duration_ms`
- `failure` when the response carries `X-Failure-*` or status ≥ 400
- Levels: 5xx → `error`, 4xx → `warn`, else `info`

---

## 9. OpenTelemetry

### `initTelemetry(options)`

```ts
interface TelemetryOptions {
  service: string;
  environment?: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  sampleRatio?: number;
  enabled?: boolean;
  spanProcessor?: unknown;      // test injection
  instrumentations?: unknown[]; // test injection
  resourceAttributes?: Record<string, string>;
}
```

Loads the OTel SDK dynamically. When packages are missing, returns `{ enabled: false, reason }` and TraceKit keeps working. Uses trace-id probabilistic sampling (parent-aware) and OTLP HTTP export to `<endpoint>/v1/traces`.

### `shutdownTelemetry()`

Flushes and shuts down the SDK. Call during graceful shutdown.

### `isTelemetryInitialized()`

`boolean`.

### `hasOpenTelemetry()`

`boolean`. True when `@opentelemetry/api` is resolvable.

### `getActiveSpanContext()`

Returns `{ traceId, spanId, traceFlags }` for the active OTel span, or `null`.

### `getActiveTraceparent()`

Active span as a W3C header value, or `null`.

### `withSpan(name, fn, attributes?)`

Runs `fn` inside a new active span when OTel is available; returns `fn`'s result. Span is always ended.

---

## 10. Async / job context

### `captureJobContext(data)`

Returns a copy of the job payload with `tracekit: TraceContext` attached from the active context. No-op when there is no context.

### `createJobContext(name)`

Creates a synthetic root context for crons/webhooks:

- `requestId: cp_<body>`, `traceId`, `spanId`, `traceparent`
- `jobId: job_<body>`, `actionId: act_<body>`, `actionName: name`, `workflowId: workflow_<body>`

### `runWithJobContext(data, fn)`

Restores the stored context (and OTel remote context from `traceparent`) and runs `fn`. Returns `fn`'s result.

### `runWithOrCreateJobContext(data, name, fn)`

Uses the stored context when present; otherwise creates a job context. `fn` receives the `TraceContext`.

### `TracedJobData`

```ts
interface TracedJobData { tracekit?: TraceContext; }
```

Serialize the full `tracekit` object into BullMQ job data, outbox rows, or webhook records.

---

## 11. Express (`@confideleap/tracekit/express`)

Also re-exported from the root: `requestContext`, `errorHandler`, `outgoingHeaders`, `httpLogger`.

### `requestContext(options?)`

```ts
interface RequestContextOptions {
  trustInbound?: boolean;   // default true
  generateMissing?: boolean; // default true
  attach?: boolean;          // default true
  idFormat?: IdFormat;
}
```

Middleware:

- Creates or accepts the context
- Sets `X-Request-Id`, `X-Trace-Id`, and `X-Workflow-Id` on the response
- Attaches it to `req.tracekit`
- Runs the rest of the chain inside `AsyncLocalStorage`
- Sets `request.id`/`action.id` attributes on the active OTel span

Place it before rate limiters and routes so 429/404 responses carry the IDs.

### `httpLogger(options)`

See section 8.

### `errorHandler(options)`

```ts
interface ErrorHandlerOptions {
  service: string;
  logger: Logger;
  format?: (err: any) => { status: number; body: unknown };
}
```

Express error middleware: classifies the failure, records it in the context, sets `X-Failure-*` headers, logs at `warn`/`error`, and sends the default JSON body or the `format` result.

### `outgoingHeaders(headers?)`

Alias for `injectTraceHeaders` for use in Express services.

### Types

`ExpressRequest` (`headers`, `method`, `url`, `originalUrl`, `tracekit?`), `ExpressResponse` (`setHeader`, `getHeader?`, `on`, `statusCode?`), `NextFunction`.

---

## 12. Apollo (`@confideleap/tracekit/apollo`)

### `tracekitApolloPlugin()`

Apollo Server plugin. On `willSendResponse`, attaches to each GraphQL error:

```json
{ "requestId": "cp_...", "traceId": "...", "failureStage": "...", "failureService": "..." }
```

Existing error extensions are preserved; response-level extensions are set when errors exist.

---

## 13. Next.js (`@confideleap/tracekit/next`)

### `contextFromNextHeaders(headers)`

Builds a `TraceContext` from a Web `Headers` object.

### `responseHeadersFromContext(context, extra?)`

Returns `{ 'X-Request-Id', 'X-Trace-Id', ...extra }`.

### `withNextRequestContext(headers, fn)`

Runs a route handler inside the derived context; `fn` receives the `TraceContext`.

### `forwardedRequestHeaders(headers, context?)`

Returns request headers with `x-request-id`, `traceparent`, `x-action-id`, `x-workflow-id` injected, for proxy rewrites or server-side calls.

---

## 14. Browser / Faro (`@confideleap/tracekit/web`)

Browser-safe: no Node built-ins. Apps own all UI.

### `initWebTracking(options)`

```ts
interface WebTrackingOptions {
  app: string;
  fetchImpl?: typeof fetch;
  install?: boolean;   // default true when no fetchImpl
  idFormat?: IdFormat;
}
```

Wraps `globalThis.fetch` (or the provided fetch) to:

- add `X-Action-Id` while an action is active
- capture `X-Request-Id`, `X-Trace-Id`, `X-Workflow-Id`, `X-Failure-Stage`, `X-Failure-Service`, and status into the last reference

### `getWebFetch()`

Returns the wrapped fetch.

### `startWebAction(name, idFormat?)`

Starts a user action and returns its `act_<body>` ID.

### `endWebAction()` / `getCurrentWebAction()`

Ends or reads the active action.

### `getLastReference()`

```ts
interface WebReference {
  app: string; route: string; at: string;
  actionId?: string; actionName?: string;
  requestId?: string; traceId?: string; workflowId?: string;
  failureStage?: string; failureService?: string;
  httpStatus?: number;
}
```

### `recordWebReference(patch)`

Lets custom transports (axios/XHR interceptors) feed reference data. Returns the updated reference.

### `normalizeRequestReference(value)`

Browser-safe request ID normalization (`cp_*`, `req_*`, bare ULID/UUIDv7).

### `initFaro(options)`

```ts
interface FaroOptions {
  collectorUrl: string;   // runtime env, e.g. window.__ENV.FARO_COLLECTOR_URL
  appName: string;
  environment?: string;
  version?: string;
  enabled?: boolean;
  sdk?: { initializeFaro(options): unknown };
  tracing?: {
    TracingInstrumentation?: new (options?: unknown) => unknown;
    getTracingInstrumentation?: (options?: unknown) => unknown;
  };
  sessionTracking?: unknown;
}
```

Headless initialization. The app installs Faro and passes the SDK objects; TraceKit never hardcodes the collector URL. Returns `true` on success, `false` with a one-time warning otherwise.

### `getFaroInstance()`

The value returned by `initializeFaro`, or `null`.

### `resetWebTrackingForTests()`

Resets module state.

---

## 15. Testing (`@confideleap/tracekit/testing`)

### `createMemoryLogger(options)`

```ts
interface MemoryLogSink {
  lines: Record<string, unknown>[];
  raw: string[];
  logger: Logger;
}
```

Creates a logger whose output is captured in memory.

### `findLog(sink, predicate)`

Returns the first captured record matching the predicate.

### `createLogger`

Re-export of the logger factory.

---

## 16. Headers and ID contract

| Header | Direction | Description |
|---|---|---|
| `X-Request-Id` | both | `cp_<ULID>` / `cp_<UUIDv7>` / legacy `req_` |
| `X-Trace-Id` | response | 32 hex trace id |
| `X-Action-Id` | both | `act_*` |
| `X-Workflow-Id` | both | `workflow_*` |
| `traceparent` | both | W3C trace context |
| `X-Failure-Stage` | response | Failure location |
| `X-Failure-Service` | response | Failing service |
| `X-Failure-Operation` | response | Failing operation |
| `X-Failure-Code` | response | Sanitized error code |

CORS must expose `X-Request-Id`, `X-Trace-Id`, `X-Action-Id`, `X-Workflow-Id`, `X-Failure-Stage`, `X-Failure-Service`, `Server-Timing`.

## 17. Environment variables

| Variable | Used by | Description |
|---|---|---|
| `TELEMETRY_ENABLED` | all | `false` disables exporters |
| `TRACEKIT_ID_FORMAT` | all | `ulid` (default) or `uuidv7` |
| `TRACEKIT_REQUIRE_NATIVE` | Node | `true` throws when the native addon is missing |
| `OTEL_SERVICE_NAME` | Node/Next | Service identity |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Node/Next | OTLP endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Node/Next | `http/protobuf` |
| `OTEL_RESOURCE_ATTRIBUTES` | Node/Next | Resource attributes |
| `TELEMETRY_SAMPLE_RATIO` | Node/Next | Trace sampling ratio |
| `FARO_COLLECTOR_URL` | browser (runtime) | Faro receiver URL |
| `FARO_APP_NAME` | browser (runtime) | Faro app name |

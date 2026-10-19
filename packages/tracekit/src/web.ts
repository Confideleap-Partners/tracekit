/**
 * Browser entry: headless request tracking and Faro integration.
 *
 * This module is browser-safe: it must not import any Node built-in. Apps own
 * all UI; TraceKit only propagates context and captures the last request
 * reference so an application can display or report it.
 */

import { generateBrowserIdBody, normalizeBrowserRequestId } from './browser-core';
import type { IdFormat } from './types';

export interface WebReference {
  app: string;
  route: string;
  at: string;
  actionId?: string;
  actionName?: string;
  requestId?: string;
  traceId?: string;
  workflowId?: string;
  failureStage?: string;
  failureService?: string;
  httpStatus?: number;
}

export interface WebTrackingOptions {
  app: string;
  fetchImpl?: typeof fetch;
  /** Install the wrapped fetch on globalThis (default true when no custom fetchImpl). */
  install?: boolean;
  /** ID format for generated action IDs. Defaults to the configured format. */
  idFormat?: IdFormat;
}

export interface FaroApp {
  name: string;
  environment?: string;
  version?: string;
}

export interface FaroInitializeOptions {
  url: string;
  app: FaroApp;
  instrumentations?: unknown[];
  sessionTracking?: unknown;
  [key: string]: unknown;
}

export interface FaroStatic {
  initializeFaro(options: FaroInitializeOptions): unknown;
}

export interface FaroTracingStatic {
  TracingInstrumentation?: new (options?: unknown) => unknown;
  getTracingInstrumentation?: (options?: unknown) => unknown;
}

export interface FaroOptions {
  /** Runtime env value, for example window.__ENV.FARO_COLLECTOR_URL. */
  collectorUrl: string;
  appName: string;
  environment?: string;
  version?: string;
  enabled?: boolean;
  /** Injected @grafana/faro-web-sdk module. */
  sdk?: FaroStatic;
  /** Injected @grafana/faro-web-tracing module. */
  tracing?: FaroTracingStatic;
  sessionTracking?: unknown;
}

let lastReference: WebReference | null = null;
let currentAction: { id: string; name: string } | null = null;
let options: WebTrackingOptions | null = null;
let wrappedFetch: typeof fetch | null = null;
let installedOnGlobal = false;
let faroInstance: unknown = null;
let faroWarned = false;

const WRAPPED = Symbol.for('tracekit.web.fetch');

function currentRoute(): string {
  try {
    const location = (globalThis as { location?: { pathname?: string } }).location;
    if (location?.pathname) return String(location.pathname);
  } catch {
    // ignore
  }
  return '/';
}

function routeFromInput(input: RequestInfo | URL): string {
  try {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return currentRoute();
  }
}

/**
 * Record or update the last request reference. Exposed so applications can
 * feed references from custom transports (for example an axios interceptor).
 */
export function recordWebReference(patch: Partial<WebReference>): WebReference {
  const app = patch.app ?? options?.app ?? 'unknown';
  lastReference = {
    app,
    route: currentRoute(),
    at: new Date().toISOString(),
    actionId: currentAction?.id,
    actionName: currentAction?.name,
    ...lastReference,
    ...patch,
  };
  return lastReference;
}

function makeWebFetch(original: typeof fetch): typeof fetch {
  const wrapped = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (currentAction && !headers.has('x-action-id')) {
      headers.set('x-action-id', currentAction.id);
    }
    recordWebReference({ route: routeFromInput(input) });

    try {
      const response = await original(input, { ...init, headers });
      recordWebReference({
        requestId: response.headers.get('x-request-id') ?? undefined,
        traceId: response.headers.get('x-trace-id') ?? undefined,
        workflowId: response.headers.get('x-workflow-id') ?? undefined,
        failureStage: response.headers.get('x-failure-stage') ?? undefined,
        failureService: response.headers.get('x-failure-service') ?? undefined,
        httpStatus: response.status,
      });
      return response;
    } catch (err) {
      recordWebReference({ failureStage: 'client.network', failureService: undefined });
      throw err;
    }
  }) as typeof fetch;
  Object.defineProperty(wrapped, WRAPPED, { value: true });
  return wrapped;
}

/** Initialize browser tracking. Safe to call more than once. */
export function initWebTracking(next: WebTrackingOptions): void {
  options = next;
  if (
    next.install !== false &&
    !next.fetchImpl &&
    typeof globalThis.fetch === 'function' &&
    !installedOnGlobal
  ) {
    globalThis.fetch = getWebFetch();
    installedOnGlobal = true;
  }
}

/** Returns the wrapped fetch (installing it when tracking is initialized). */
export function getWebFetch(): typeof fetch {
  if (wrappedFetch) return wrappedFetch;
  const original = options?.fetchImpl ?? globalThis.fetch;
  if (!original) {
    throw new Error('TraceKit: no fetch implementation available');
  }
  if ((original as { [WRAPPED]?: boolean })[WRAPPED]) {
    wrappedFetch = original;
    return wrappedFetch;
  }
  wrappedFetch = makeWebFetch(original);
  return wrappedFetch;
}

/** Start a user action that may span several API calls. */
export function startWebAction(name: string, idFormat?: IdFormat): string {
  const format = idFormat ?? options?.idFormat ?? 'ulid';
  const id = `act_${generateBrowserIdBody(format)}`;
  currentAction = { id, name };
  recordWebReference({ actionId: id, actionName: name, route: currentRoute() });
  return id;
}

export function endWebAction(): void {
  currentAction = null;
}

export function getCurrentWebAction(): { id: string; name: string } | null {
  return currentAction;
}

export function getLastReference(): WebReference | null {
  return lastReference;
}

/** Normalize an inbound request ID using the browser-safe validator. */
export function normalizeRequestReference(value: string): string | null {
  return normalizeBrowserRequestId(value);
}

/**
 * Headless Faro initialization.
 *
 * The consuming app installs `@grafana/faro-web-sdk` and
 * `@grafana/faro-web-tracing`, passes them in, and supplies the collector URL
 * from runtime environment configuration. TraceKit never hardcodes the URL.
 */
export function initFaro(next: FaroOptions): boolean {
  if (next.enabled === false) return false;
  if (!next.collectorUrl) return false;
  if (!next.sdk?.initializeFaro) {
    if (!faroWarned) {
      faroWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[tracekit] Faro SDK not provided; skipping browser RUM. Pass sdk/tracing from @grafana/faro-web-sdk.',
      );
    }
    return false;
  }

  const instrumentations: unknown[] = [];
  const tracing = next.tracing;
  if (tracing) {
    if (typeof tracing.TracingInstrumentation === 'function') {
      instrumentations.push(new tracing.TracingInstrumentation());
    } else if (typeof tracing.getTracingInstrumentation === 'function') {
      instrumentations.push(tracing.getTracingInstrumentation());
    }
  }

  try {
    faroInstance = next.sdk.initializeFaro({
      url: next.collectorUrl,
      app: {
        name: next.appName,
        environment: next.environment,
        version: next.version,
      },
      ...(instrumentations.length ? { instrumentations } : {}),
      ...(next.sessionTracking !== undefined ? { sessionTracking: next.sessionTracking } : {}),
    });
    return true;
  } catch (err) {
    if (!faroWarned) {
      faroWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[tracekit] Faro initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return false;
  }
}

export function getFaroInstance(): unknown {
  return faroInstance;
}

/** Test hook. */
export function resetWebTrackingForTests(): void {
  lastReference = null;
  currentAction = null;
  options = null;
  wrappedFetch = null;
  installedOnGlobal = false;
  faroInstance = null;
  faroWarned = false;
}

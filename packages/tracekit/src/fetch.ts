/**
 * Fetch instrumentation: propagates context and records downstream failures.
 */

import { currentContext, injectTraceHeaders } from './context';
import { failureFromHeaders, markFailure, recordFailure } from './failure';
import {
  getActiveSpanContext,
  hasOpenTelemetry,
  runWithRemoteContext,
  withSpan,
} from './otel-bridge';
import type { FailureInfo, HeaderLike } from './types';

const responseFailure = new WeakMap<Response, FailureInfo>();

export interface TracedFetchOptions {
  serviceName?: string;
  spanName?: string;
  propagate?: boolean;
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function perform(input: RequestInfo | URL, init: RequestInit, span: any, options: TracedFetchOptions): Promise<Response> {
  const headers = options.propagate === false ? init.headers : (injectTraceHeaders((init.headers as HeaderLike) ?? {}) as HeadersInit);
  const method = init.method ?? 'GET';
  const url = resolveUrl(input);
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }

  try {
    const response = await fetch(input, { ...init, headers });
    span?.setAttribute?.('http.response.status_code', response.status);
    if (response.status >= 400) {
      const fromHeaders = failureFromHeaders(response.headers);
      const info: FailureInfo = fromHeaders
        ? { ...fromHeaders, status: fromHeaders.status ?? response.status }
        : {
            stage: 'downstream',
            service: options.serviceName,
            operation: `${method} ${host}`,
            status: response.status,
          };
      responseFailure.set(response, info);
      if (response.status >= 500) recordFailure(info);
    }
    return response;
  } catch (err) {
    const info: FailureInfo = {
      stage: 'downstream',
      service: options.serviceName,
      operation: `${method} ${host}`,
      message: err instanceof Error ? err.message : String(err),
    };
    markFailure(err, info);
    recordFailure(info);
    throw err;
  }
}

/**
 * Ensure a client span is parented by the TraceKit context when no OTel span
 * is active. Without this, a standalone client span would start a new trace
 * instead of continuing the request trace.
 */
function withContextParent<T>(fn: () => T): T {
  const context = currentContext();
  if (context?.traceparent && !getActiveSpanContext()) {
    return runWithRemoteContext(context.traceparent, fn);
  }
  return fn();
}

/**
 * `fetch` with request/trace propagation, a client span when OTel is present,
 * and failure classification for the caller.
 */
export async function tracedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: TracedFetchOptions = {},
): Promise<Response> {
  const method = init.method ?? 'GET';
  const url = resolveUrl(input);
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  const spanName = options.spanName ?? `${method} ${host || url}`;

  if (hasOpenTelemetry()) {
    return withContextParent(
      () =>
        withSpan(spanName, (span) => perform(input, init, span, options), {
          'http.request.method': method,
          'server.address': host,
        }) as Promise<Response>,
    );
  }
  return perform(input, init, null, options);
}

export function getResponseFailure(response: Response): FailureInfo | undefined {
  return responseFailure.get(response);
}

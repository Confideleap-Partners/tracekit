/**
 * Next.js helpers.
 *
 * Use these inside `instrumentation.ts`, `proxy.ts`, and route handlers.
 * OpenTelemetry initialization itself lives in the main entry so the caller
 * can guard it by `NEXT_RUNTIME`.
 */

import { createContextFromHeaders, injectTraceHeaders, runWithContext } from './context';
import type { HeaderLike, TraceContext } from './types';

export function contextFromNextHeaders(headers: Headers): TraceContext {
  return createContextFromHeaders(headers);
}

export function responseHeadersFromContext(
  context: TraceContext,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'X-Request-Id': context.requestId,
    'X-Trace-Id': context.traceId,
    ...extra,
  };
}

/** Run a route handler inside the request context derived from `headers`. */
export function withNextRequestContext<T>(
  headers: Headers,
  fn: (context: TraceContext) => T | Promise<T>,
): T | Promise<T> {
  const context = contextFromNextHeaders(headers);
  return runWithContext(context, () => fn(context));
}

/**
 * Build request headers to forward (for a Next proxy rewrite or a server-side
 * API call) with `X-Request-Id` and `traceparent` attached.
 */
export function forwardedRequestHeaders(
  headers: Headers,
  context?: TraceContext,
): Record<string, string> {
  const resolved = context ?? contextFromNextHeaders(headers);
  const input: Record<string, string> = {};
  headers.forEach((value, key) => {
    input[key] = value;
  });
  return injectTraceHeaders(input, resolved) as Record<string, string>;
}

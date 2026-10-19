/**
 * Optional bridge to `@opentelemetry/api`.
 *
 * TraceKit works without OpenTelemetry installed. When the API is present, the
 * request context prefers the active OTel span, outgoing calls create client
 * spans, and asynchronous jobs resume the OTel context.
 */

import type { TraceContext } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let otelApi: any = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  otelApi = require('@opentelemetry/api');
} catch {
  otelApi = null;
}

export function hasOpenTelemetry(): boolean {
  return otelApi !== null;
}

export interface ActiveSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export function getActiveSpanContext(): ActiveSpanContext | null {
  if (!otelApi) return null;
  const span = otelApi.trace.getActiveSpan?.() ?? otelApi.trace.getSpan?.(otelApi.context.active());
  if (!span) return null;
  const spanContext = span.spanContext?.();
  if (!spanContext) return null;
  const traceId: string = spanContext.traceId;
  const spanId: string = spanContext.spanId;
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(spanId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId, traceFlags: spanContext.traceFlags ?? 1 };
}

export function getActiveTraceparent(): string | null {
  const active = getActiveSpanContext();
  if (!active) return null;
  const flags = (active.traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${active.traceId}-${active.spanId}-${flags}`;
}

/** Set attributes on the active span when OpenTelemetry is present. */
export function setActiveSpanAttributes(
  attributes: Record<string, string | number | boolean>,
): void {
  if (!otelApi) return;
  const span = otelApi.trace.getActiveSpan?.() ?? otelApi.trace.getSpan?.(otelApi.context.active());
  if (!span?.setAttribute) return;
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}

/**
 * Run a function inside a new OTel span when the API is available. The span is
 * always ended. Attribute values are primitive-only.
 */
export function withSpan<T>(
  name: string,
  fn: (span: unknown | null) => T,
  attributes: Record<string, string | number | boolean> = {},
): T {
  if (!otelApi) return fn(null);
  const tracer = otelApi.trace.getTracer('@confideleap-partners/tracekit');
  return tracer.startActiveSpan(name, (span: any) => {
    try {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute?.(key, value);
      }
      return fn(span);
    } finally {
      span.end?.();
    }
  });
}

/**
 * Run a function with an explicit remote span context from a stored
 * traceparent. Used to continue traces across BullMQ/outbox/webhook work.
 */
export function runWithRemoteContext<T>(traceparent: string, fn: () => T): T {
  if (!otelApi) return fn();
  const parsed = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(traceparent);
  if (!parsed) return fn();
  const [, traceId, spanId, flags] = parsed;
  const spanContext = {
    traceId,
    spanId,
    traceFlags: parseInt(flags, 16),
    isRemote: true,
  };
  const remoteSpan = otelApi.trace.wrapSpanContext?.(spanContext);
  const context = remoteSpan
    ? otelApi.trace.setSpan(otelApi.context.active(), remoteSpan)
    : otelApi.context.active();
  return otelApi.context.with(context, fn);
}

export function describeActiveContext(context: TraceContext): TraceContext {
  const active = getActiveSpanContext();
  if (!active) return context;
  return {
    ...context,
    traceId: active.traceId,
    spanId: active.spanId,
    traceparent: `00-${active.traceId}-${active.spanId}-${(active.traceFlags & 0xff)
      .toString(16)
      .padStart(2, '0')}`,
  };
}

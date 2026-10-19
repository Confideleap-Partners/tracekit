/**
 * Request context storage and propagation.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { generateRequestId } from './ids';
import { core } from './native';
import { getActiveSpanContext } from './otel-bridge';
import type { HeaderLike, IdFormat, TraceContext } from './types';

const storage = new AsyncLocalStorage<TraceContext>();

function readHeader(headers: HeaderLike | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lower) continue;
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    if (value === undefined) return undefined;
    return String(value);
  }
  return undefined;
}

/** Normalize Web `Headers`, Node request headers, or a plain object. */
export function toHeaderLike(input: HeaderLike | Headers | undefined): HeaderLike {
  if (!input) return {};
  if (
    typeof (input as Headers).forEach === 'function' &&
    typeof (input as Headers).get === 'function'
  ) {
    const out: HeaderLike = {};
    (input as Headers).forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return input as HeaderLike;
}

/**
 * Build a TraceContext from inbound headers. The request ID is preserved when
 * valid, the trace context prefers the active OTel span, then the inbound
 * `traceparent`, then a freshly generated one.
 */
export function createContextFromHeaders(
  headers?: HeaderLike | Headers,
  options: { generateMissing?: boolean; idFormat?: IdFormat } = {},
): TraceContext {
  const generateMissing = options.generateMissing !== false;
  const normalizedHeaders = toHeaderLike(headers);
  const binding = core();

  const inboundRequestId = readHeader(normalizedHeaders, 'x-request-id');
  const requestId =
    (inboundRequestId ? binding.normalizeRequestId(inboundRequestId) : null) ??
    (generateMissing ? generateRequestId(options.idFormat) : '');

  const inboundActionId = readHeader(normalizedHeaders, 'x-action-id');
  const actionId = inboundActionId
    ? (binding.normalizeActionId(inboundActionId) ?? undefined)
    : undefined;

  const inboundWorkflowId = readHeader(normalizedHeaders, 'x-workflow-id');
  const workflowId = inboundWorkflowId
    ? (binding.normalizeWorkflowId(inboundWorkflowId) ?? undefined)
    : undefined;

  const inboundTraceparent = readHeader(normalizedHeaders, 'traceparent');
  const parsed = inboundTraceparent ? binding.parseTraceparent(inboundTraceparent) : null;
  const active = getActiveSpanContext();

  let traceId: string;
  let spanId: string;
  let traceparent: string;

  if (active) {
    traceId = active.traceId;
    spanId = active.spanId;
    traceparent =
      binding.formatTraceparent(traceId, spanId, active.traceFlags) ??
      `00-${traceId}-${spanId}-${(active.traceFlags & 0xff).toString(16).padStart(2, '0')}`;
  } else if (parsed) {
    traceId = parsed.traceId;
    spanId = parsed.spanId;
    traceparent =
      binding.formatTraceparent(traceId, spanId, parsed.flags) ??
      `00-${traceId}-${spanId}-${parsed.flags.toString(16).padStart(2, '0')}`;
  } else {
    traceId = binding.newTraceId();
    spanId = binding.newSpanId();
    traceparent = binding.formatTraceparent(traceId, spanId, 1) ?? '';
  }

  return { requestId, traceId, spanId, traceparent, actionId, workflowId };
}

export function runWithContext<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): TraceContext | undefined {
  return storage.getStore();
}

export function requireContext(): TraceContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error('TraceKit: no active request context');
  }
  return context;
}

/** Mutate the active context in place (for example after authentication). */
export function updateContext(patch: Partial<TraceContext>): TraceContext | undefined {
  const context = storage.getStore();
  if (!context) return undefined;
  Object.assign(context, patch);
  return context;
}

export function contextToLogFields(context: TraceContext | undefined): Record<string, string> {
  if (!context) return {};
  const fields: Record<string, string> = {
    request_id: context.requestId,
    trace_id: context.traceId,
    span_id: context.spanId,
  };
  if (context.actionId) fields.action_id = context.actionId;
  if (context.actionName) fields.action_name = context.actionName;
  if (context.jobId) fields.job_id = context.jobId;
  if (context.workflowId) fields.workflow_id = context.workflowId;
  if (context.tenantId) fields.tenant_id = context.tenantId;
  if (context.userId) fields.user_id = context.userId;
  if (context.failureStage) fields.failure_stage = context.failureStage;
  if (context.failureService) fields.failure_service = context.failureService;
  return fields;
}

/** Current traceparent, preferring the active OTel span. */
export function currentTraceparent(context?: TraceContext): string {
  const active = getActiveSpanContext();
  if (active) {
    const binding = core();
    return (
      binding.formatTraceparent(active.traceId, active.spanId, active.traceFlags) ??
      `00-${active.traceId}-${active.spanId}-${(active.traceFlags & 0xff).toString(16).padStart(2, '0')}`
    );
  }
  const ctx = context ?? storage.getStore();
  if (ctx) return ctx.traceparent;
  const binding = core();
  return binding.formatTraceparent(binding.newTraceId(), binding.newSpanId(), 1) ?? '';
}

/**
 * Build outgoing headers with request/trace context.
 */
export function injectTraceHeaders(
  headers: HeaderLike | Headers = {},
  context?: TraceContext,
): HeaderLike {
  const out = toHeaderLike(headers);
  const ctx = context ?? storage.getStore();
  const traceparent = currentTraceparent(ctx);
  if (traceparent) out.traceparent = traceparent;
  if (ctx?.requestId) out['x-request-id'] = ctx.requestId;
  if (ctx?.actionId) out['x-action-id'] = ctx.actionId;
  if (ctx?.workflowId) out['x-workflow-id'] = ctx.workflowId;
  return out;
}

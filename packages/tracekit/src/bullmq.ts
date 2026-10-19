/**
 * Async/job context helpers.
 *
 * Works with BullMQ, outbox rows, crons, and webhooks. The queue payload is
 * intentionally plain JSON so it can be stored in Postgres or Redis.
 */

import { currentContext, runWithContext } from './context';
import { generateActionId, generateJobId, generateRequestId, generateWorkflowId } from './ids';
import { core } from './native';
import { runWithRemoteContext } from './otel-bridge';
import type { TraceContext } from './types';

export interface TracedJobData {
  tracekit?: TraceContext;
}

/** Copy the active context into a job payload. */
export function captureJobContext<T extends Record<string, unknown>>(data: T): T & TracedJobData {
  const context = currentContext();
  if (!context) return data as T & TracedJobData;
  return { ...data, tracekit: { ...context } };
}

/** Create a synthetic root context for crons and jobs started outside a request. */
export function createJobContext(name: string): TraceContext {
  const binding = core();
  const traceId = binding.newTraceId();
  const spanId = binding.newSpanId();
  return {
    requestId: generateRequestId(),
    traceId,
    spanId,
    traceparent: binding.formatTraceparent(traceId, spanId, 1) ?? '',
    jobId: generateJobId(),
    actionId: generateActionId(),
    actionName: name,
    workflowId: generateWorkflowId(),
  };
}

/**
 * Run a worker function inside the job's stored context. The OTel context is
 * continued through the stored traceparent when OpenTelemetry is available.
 */
export function runWithJobContext<T>(
  data: TracedJobData | undefined,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const context = data?.tracekit;
  if (!context) return fn();
  const restore = () => runWithContext(context, fn);
  if (context.traceparent) {
    return runWithRemoteContext(context.traceparent, restore);
  }
  return restore();
}

/** Run with the job context, creating one when the payload has none. */
export function runWithOrCreateJobContext<T>(
  data: TracedJobData | undefined,
  name: string,
  fn: (context: TraceContext) => T | Promise<T>,
): T | Promise<T> {
  if (data?.tracekit) {
    const context = data.tracekit;
    const restore = () => runWithContext(context, () => fn(context));
    return context.traceparent ? runWithRemoteContext(context.traceparent, restore) : restore();
  }
  const context = createJobContext(name);
  return runWithContext(context, () => fn(context));
}

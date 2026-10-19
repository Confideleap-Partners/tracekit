/**
 * TraceKit — end-to-end request tracking SDK.
 */

export * from './types';
export {
  configureTraceKit,
  DEFAULT_ID_FORMAT,
  generateActionId,
  generateJobId,
  generateRequestId,
  generateWorkflowId,
  getIdFormat,
  isValidIdFormat,
  resetTraceKitConfig,
  type TraceKitConfig,
} from './ids';
export { initTraceKit, type InitTraceKitOptions } from './bootstrap';
export { core, isNativeAvailable, jsFallback, type NativeApi } from './native';
export {
  contextToLogFields,
  createContextFromHeaders,
  currentContext,
  currentTraceparent,
  injectTraceHeaders,
  requireContext,
  runWithContext,
  toHeaderLike,
  updateContext,
} from './context';
export {
  classifyError,
  classifyStatus,
  contextFailure,
  failureFromHeaders,
  getFailure,
  markFailure,
  recordFailure,
  setFailureHeaders,
} from './failure';
export { getResponseFailure, tracedFetch, type TracedFetchOptions } from './fetch';
export { createLogger, httpLogger, type Logger, type LoggerOptions, type LogLevel } from './logger';
export {
  initTelemetry,
  isTelemetryInitialized,
  shutdownTelemetry,
  type TelemetryInitResult,
  type TelemetryOptions,
} from './otel';
export {
  captureJobContext,
  createJobContext,
  runWithJobContext,
  runWithOrCreateJobContext,
  type TracedJobData,
} from './bullmq';
export { errorHandler, outgoingHeaders, requestContext, type ExpressRequest, type ExpressResponse, type RequestContextOptions } from './express';
export { hasOpenTelemetry, getActiveSpanContext, getActiveTraceparent, withSpan } from './otel-bridge';

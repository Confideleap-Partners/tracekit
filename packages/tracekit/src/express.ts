/**
 * Express-compatible middleware. No Express dependency is required; the
 * structural types match Express' `Request`/`Response`.
 */

import { createContextFromHeaders, injectTraceHeaders, runWithContext } from './context';
import { classifyError, recordFailure, setFailureHeaders } from './failure';
import type { Logger } from './logger';
import { httpLogger } from './logger';
import { setActiveSpanAttributes } from './otel-bridge';
import type { HeaderLike, IdFormat, TraceContext } from './types';

export interface RequestContextOptions {
  /** Accept a valid inbound X-Request-Id instead of always generating. */
  trustInbound?: boolean;
  /** Generate a request ID when no valid inbound one exists. */
  generateMissing?: boolean;
  /** Attach the context to req.tracekit (default true). */
  attach?: boolean;
  /** ID format for generated request IDs. Defaults to the configured format. */
  idFormat?: IdFormat;
}

export interface ExpressRequest {
  headers: HeaderLike;
  method?: string;
  url?: string;
  originalUrl?: string;
  tracekit?: TraceContext;
  route?: { path?: string };
  baseUrl?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ExpressResponse {
  statusCode?: number;
  setHeader(name: string, value: string | number): void;
  getHeader?(name: string): number | string | string[] | undefined;
  on(event: string, listener: () => void): void;
  headersSent?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type NextFunction = (err?: unknown) => void;

/**
 * Create/accept the request context, attach it to the request, and run the
 * rest of the middleware chain inside it.
 */
export function requestContext(options: RequestContextOptions = {}) {
  const { trustInbound = true, generateMissing = true, attach = true } = options;
  return (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
    if (req.tracekit) {
      res.setHeader('X-Request-Id', req.tracekit.requestId);
      res.setHeader('X-Trace-Id', req.tracekit.traceId);
      if (req.tracekit.workflowId) res.setHeader('X-Workflow-Id', req.tracekit.workflowId);
      runWithContext(req.tracekit, () => next());
      return;
    }

    const context = createContextFromHeaders(trustInbound ? req.headers : {}, {
      generateMissing,
      idFormat: options.idFormat,
    });

    if (attach) req.tracekit = context;
    res.setHeader('X-Request-Id', context.requestId);
    res.setHeader('X-Trace-Id', context.traceId);
    if (context.workflowId) res.setHeader('X-Workflow-Id', context.workflowId);
    setActiveSpanAttributes({
      'request.id': context.requestId,
      'confideleap.request.id': context.requestId,
      ...(context.actionId ? { 'action.id': context.actionId } : {}),
    });

    runWithContext(context, () => next());
  };
}

export interface ErrorHandlerOptions {
  service: string;
  logger: Logger;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format?: (err: any) => { status: number; body: unknown };
}

/**
 * Generic error handler that records the failure stage on the response and
 * logs it. Applications can keep their existing response shape through
 * `format`.
 */
export function errorHandler(options: ErrorHandlerOptions) {
  return (err: unknown, _req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
    const classified = classifyError(err);
    const info = { ...classified, service: classified.service ?? options.service };
    recordFailure(info);
    setFailureHeaders(res, info);

    const status = info.status ?? 500;
    if (status >= 500) {
      options.logger.error('unhandled request error', { err, failure: info });
    } else {
      options.logger.warn('request error', { err, failure: info });
    }

    if (res.headersSent) {
      next(err);
      return;
    }

    const formatted = options.format
      ? options.format(err)
      : {
          status,
          body: {
            success: false,
            error:
              status >= 500
                ? 'Internal server error'
                : err instanceof Error
                  ? err.message
                  : 'Request failed',
          },
        };

    res.statusCode = formatted.status;
    if (typeof res.json === 'function') {
      res.json(formatted.body);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end?.(JSON.stringify(formatted.body));
    }
  };
}

/** Build outgoing headers for a fetch/axios call. */
export function outgoingHeaders(headers: HeaderLike = {}): HeaderLike {
  return injectTraceHeaders(headers);
}

export { httpLogger };

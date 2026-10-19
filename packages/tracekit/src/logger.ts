/**
 * Structured JSON logger with request context and redaction.
 */

import { contextToLogFields, currentContext } from './context';
import { classifyStatus, contextFailure } from './failure';
import { core } from './native';
import type { FailureInfo } from './types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  service: string;
  env?: string;
  version?: string;
  level?: LogLevel;
  redactKeys?: string[];
  /** Test hook; defaults to process.stdout. */
  sink?: (line: string, record: Record<string, unknown>) => void;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  readonly options: LoggerOptions;
}

function serializeError(err: Error, includeStack: boolean): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    ...(includeStack && err.stack ? { stack: err.stack } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlain(value: any, includeStack: boolean): unknown {
  if (value instanceof Error) return serializeError(value, includeStack);
  if (Array.isArray(value)) return value.map((item) => toPlain(item, includeStack));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = toPlain(child, includeStack);
    }
    return out;
  }
  return value;
}

export function createLogger(options: LoggerOptions): Logger {
  const {
    service,
    env = process.env.NODE_ENV ?? 'development',
    version,
    level = 'info',
    redactKeys = [],
    sink,
  } = options;
  const minWeight = LEVEL_WEIGHT[level];
  const includeStack = env !== 'production';

  const emit = (bindings: Record<string, unknown>) => {
    return (logLevel: LogLevel, message: string, meta?: Record<string, unknown>) => {
      if (LEVEL_WEIGHT[logLevel] < minWeight) return;
      const context = currentContext();
      const record: Record<string, unknown> = {
        time: new Date().toISOString(),
        level: logLevel,
        service,
        env,
        ...(version ? { version } : {}),
        ...contextToLogFields(context),
        ...bindings,
        msg: message,
        ...(meta ? { meta: toPlain(meta, includeStack) as Record<string, unknown> } : {}),
      };

      let line: string;
      try {
        const serialized = JSON.stringify(record);
        line = core().redactJson(serialized, redactKeys) ?? serialized;
      } catch {
        line = JSON.stringify({ time: record.time, level: logLevel, service, msg: message });
      }

      if (sink) {
        try {
          sink(line, JSON.parse(line) as Record<string, unknown>);
        } catch {
          sink(line, record);
        }
      } else {
        process.stdout.write(`${line}\n`);
      }
    };
  };

  const make = (bindings: Record<string, unknown>): Logger => {
    const log = emit(bindings);
    return {
      debug: (message, meta) => log('debug', message, meta),
      info: (message, meta) => log('info', message, meta),
      warn: (message, meta) => log('warn', message, meta),
      error: (message, meta) => log('error', message, meta),
      child: (extra) => make({ ...bindings, ...extra }),
      options,
    };
  };

  return make({});
}

export interface HttpLoggerOptions {
  logger: Logger;
  /** Include the route template when Express provides it. */
  includeRoute?: boolean;
}

export interface MinimalRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  route?: { path?: string };
  baseUrl?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface MinimalResponse {
  statusCode?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getHeader?(name: string): any;
  on(event: string, listener: () => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function normalizeRoute(req: MinimalRequest, includeRoute: boolean): string {
  if (includeRoute && req.route?.path) {
    return `${req.baseUrl ?? ''}${req.route.path}` || req.route.path;
  }
  const raw = req.originalUrl ?? req.url ?? '';
  return raw.split('?')[0] ?? raw;
}

export function httpLogger(options: HttpLoggerOptions) {
  const { logger, includeRoute = true } = options;
  return (req: MinimalRequest, res: MinimalResponse, next: (err?: unknown) => void): void => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const status = res.statusCode ?? 0;

      let failure: FailureInfo | undefined;
      const headerStage = res.getHeader?.('X-Failure-Stage');
      const headerService = res.getHeader?.('X-Failure-Service');
      const headerOperation = res.getHeader?.('X-Failure-Operation');
      if (headerStage) {
        failure = {
          stage: String(headerStage) as FailureInfo['stage'],
          service: headerService ? String(headerService) : undefined,
          operation: headerOperation ? String(headerOperation) : undefined,
        };
      } else if (status >= 400) {
        failure = { stage: classifyStatus(status), status };
      }
      if (!failure) failure = contextFailure(currentContext());

      const payload = {
        http: {
          request: { method: req.method ?? 'GET' },
          route: normalizeRoute(req, includeRoute),
          response: { status_code: status },
        },
        duration_ms: Number(durationMs.toFixed(3)),
        ...(failure ? { failure } : {}),
      };

      if (status >= 500) logger.error('request failed', payload);
      else if (status >= 400) logger.warn('request rejected', payload);
      else logger.info('request completed', payload);
    });
    next();
  };
}

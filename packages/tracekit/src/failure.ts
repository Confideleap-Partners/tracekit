/**
 * Failure classification shared by services, logs, and telemetry consumers.
 */

import { toHeaderLike, updateContext } from './context';
import type { FailureInfo, FailureStage, HeaderLike, TraceContext } from './types';

const FAILURE = Symbol.for('tracekit.failure');

export function classifyStatus(status: number): FailureStage {
  if (status === 401) return 'auth.session';
  if (status === 403) return 'auth.authorization';
  if (status === 400 || status === 422) return 'validation.input';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'service.handler';
  if (status >= 500) return 'service.handler';
  return 'unknown';
}

export function classifyError(err: unknown): FailureInfo {
  const existing = getFailure(err);
  if (existing) return existing;

  if (err && typeof err === 'object') {
    const candidate = err as {
      status?: number;
      statusCode?: number;
      code?: string;
      name?: string;
      message?: string;
    };
    const status = candidate.status ?? candidate.statusCode;
    if (status) {
      return {
        stage: classifyStatus(status),
        status,
        errorCode: candidate.code,
        message: candidate.message,
      };
    }
    const code = candidate.code ?? '';
    if (/^P\d{4}$/.test(code) || /^23\d{3}$/.test(code) || /^42/.test(code)) {
      return { stage: 'database', errorCode: code, message: candidate.message };
    }
    if (
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      candidate.name === 'AbortError' ||
      candidate.name === 'TimeoutError'
    ) {
      return { stage: 'downstream', errorCode: code, message: candidate.message };
    }
  }

  return {
    stage: 'service.handler',
    message: err instanceof Error ? err.message : String(err),
  };
}

/** Attach failure metadata to an error so upstream layers can reuse it. */
export function markFailure<T>(err: T, info: FailureInfo): T {
  if (err && typeof err === 'object') {
    Object.defineProperty(err, FAILURE, {
      value: info,
      enumerable: false,
      configurable: true,
    });
  }
  return err;
}

export function getFailure(err: unknown): FailureInfo | undefined {
  if (!err || typeof err !== 'object') return undefined;
  return (err as { [FAILURE]?: FailureInfo })[FAILURE];
}

function readHeader(headers: HeaderLike | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== lower) continue;
    const value = headers[key];
    if (Array.isArray(value)) return value[0];
    return value === undefined ? undefined : String(value);
  }
  return undefined;
}

/** Failure info supplied by a downstream service via response headers. */
export function failureFromHeaders(
  headers: HeaderLike | Headers | undefined,
): FailureInfo | undefined {
  const normalized = toHeaderLike(headers);
  const stage = readHeader(normalized, 'x-failure-stage') as FailureStage | undefined;
  const service = readHeader(normalized, 'x-failure-service');
  const operation = readHeader(normalized, 'x-failure-operation');
  const code = readHeader(normalized, 'x-failure-code');
  if (!stage && !service && !operation) return undefined;
  return {
    stage: stage ?? 'downstream',
    service,
    operation,
    errorCode: code,
  };
}

export function setFailureHeaders(
  res: { setHeader(name: string, value: string | number): void },
  info: FailureInfo,
): void {
  res.setHeader('X-Failure-Stage', info.stage);
  if (info.service) res.setHeader('X-Failure-Service', info.service);
  if (info.operation) res.setHeader('X-Failure-Operation', info.operation);
  if (info.errorCode) res.setHeader('X-Failure-Code', info.errorCode);
}

/** Record the failure in the active context so logs and tickets can read it. */
export function recordFailure(info: FailureInfo): void {
  updateContext({
    failureStage: info.stage,
    failureService: info.service,
  });
}

export function contextFailure(context: TraceContext | undefined): FailureInfo | undefined {
  if (!context?.failureStage) return undefined;
  return {
    stage: context.failureStage,
    service: context.failureService,
  };
}

/**
 * Shared TraceKit types.
 */

export type IdFormat = 'uuidv7' | 'ulid';

export type FailureStage =
  | 'client.network'
  | 'client.render'
  | 'client.api'
  | 'edge.proxy'
  | 'auth.session'
  | 'auth.authorization'
  | 'validation.input'
  | 'rate_limit'
  | 'service.handler'
  | 'database'
  | 'downstream'
  | 'queue.enqueue'
  | 'queue.worker'
  | 'provider.external'
  | 'unknown';

export interface FailureInfo {
  stage: FailureStage;
  service?: string;
  operation?: string;
  status?: number;
  errorCode?: string;
  message?: string;
}

export interface TraceContext {
  requestId: string;
  traceId: string;
  spanId: string;
  traceparent: string;
  actionId?: string;
  actionName?: string;
  jobId?: string;
  workflowId?: string;
  tenantId?: string;
  userId?: string;
  failureStage?: FailureStage;
  failureService?: string;
  service?: string;
  env?: string;
}

export interface TraceParent {
  traceId: string;
  spanId: string;
  flags: number;
}

export interface BaggageItem {
  key: string;
  value: string;
}

export interface HeaderLike {
  [key: string]: string | string[] | number | undefined;
}

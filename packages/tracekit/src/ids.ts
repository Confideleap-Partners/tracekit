/**
 * ID format configuration.
 *
 * TraceKit generates request IDs as `cp_<ULID>` by default, with `cp_<UUIDv7>`
 * available when the format is switched. Action and job IDs follow the same
 * body format (`act_`/`job_`). Legacy `req_<ULID>` IDs are always accepted
 * inbound, so deployments can switch generation without breaking mixed-version
 * correlation.
 */

import { core } from './native';
import type { IdFormat } from './types';

export const DEFAULT_ID_FORMAT: IdFormat = 'ulid';

export function isValidIdFormat(value: string): value is IdFormat {
  return value === 'uuidv7' || value === 'ulid';
}

let currentIdFormat: IdFormat = DEFAULT_ID_FORMAT;
let environmentApplied = false;

function formatFromEnvironment(): IdFormat | null {
  try {
    if (typeof process === 'undefined' || !process.env) return null;
    const raw = process.env.TRACEKIT_ID_FORMAT;
    if (!raw) return null;
    const normalized = raw.trim().toLowerCase();
    return isValidIdFormat(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

/** Active ID format. Reads `TRACEKIT_ID_FORMAT` once unless configured. */
export function getIdFormat(): IdFormat {
  if (!environmentApplied) {
    const fromEnv = formatFromEnvironment();
    if (fromEnv) currentIdFormat = fromEnv;
    environmentApplied = true;
  }
  return currentIdFormat;
}

export interface TraceKitConfig {
  /** Format used for generated request/action/job IDs. */
  idFormat?: IdFormat;
}

/**
 * Set the ID format for generated IDs. Inbound IDs in either format are always
 * accepted and preserved.
 */
export function configureTraceKit(config: TraceKitConfig): void {
  if (config.idFormat) {
    currentIdFormat = config.idFormat;
    environmentApplied = true;
  }
}

/** Restore the default format and re-read the environment variable. */
export function resetTraceKitConfig(): void {
  currentIdFormat = DEFAULT_ID_FORMAT;
  environmentApplied = false;
}

function generateBody(format: IdFormat): string {
  return format === 'ulid' ? core().newUlid() : core().newUuidv7();
}

export function generateRequestId(format: IdFormat = getIdFormat()): string {
  return `cp_${generateBody(format)}`;
}

export function generateActionId(format: IdFormat = getIdFormat()): string {
  return `act_${generateBody(format)}`;
}

export function generateJobId(format: IdFormat = getIdFormat()): string {
  return `job_${generateBody(format)}`;
}

export function generateWorkflowId(format: IdFormat = getIdFormat()): string {
  return `workflow_${generateBody(format)}`;
}

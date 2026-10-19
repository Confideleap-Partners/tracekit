/**
 * Native binding loader with a pure TypeScript fallback.
 *
 * The native addon lives at `native/tracekit.node`. When it cannot be loaded
 * (unsupported platform, missing prebuild, Next.js standalone misconfiguration)
 * TraceKit silently falls back to the TypeScript implementation.
 */

import { createRequire } from 'node:module';
import * as js from './js-core';
import type { BaggageItem, TraceParent } from './types';

export interface NativeApi {
  newUlid(): string;
  newUuidv7(): string;
  isValidUuidv7(value: string): boolean;
  newRequestId(): string;
  newActionId(): string;
  newJobId(): string;
  newWorkflowId(): string;
  newTraceId(): string;
  newSpanId(): string;
  isValidUlid(value: string): boolean;
  isValidRequestId(value: string): boolean;
  normalizeRequestId(value: string): string | null;
  normalizeActionId(value: string): string | null;
  normalizeJobId(value: string): string | null;
  normalizeWorkflowId(value: string): string | null;
  parseTraceparent(value: string): TraceParent | null;
  formatTraceparent(traceId: string, spanId: string, flags: number): string | null;
  isValidTracestate(value: string): boolean;
  sanitizeHeaderValue(value: string): string | null;
  parseBaggage(value: string): BaggageItem[];
  formatBaggage(items: BaggageItem[]): string | null;
  shouldSample(traceId: string, ratio: number): boolean;
  redactJson(json: string, extraKeys?: string[]): string | null;
}

const jsFallback: NativeApi = {
  newUlid: js.newUlid,
  newUuidv7: js.newUuidV7,
  isValidUuidv7: js.isValidUuidV7,
  newRequestId: js.newRequestId,
  newActionId: js.newActionId,
  newJobId: js.newJobId,
  newWorkflowId: js.newWorkflowId,
  newTraceId: js.newTraceId,
  newSpanId: js.newSpanId,
  isValidUlid: js.isValidUlid,
  isValidRequestId: (value) => js.normalizeRequestId(value) !== null,
  normalizeRequestId: js.normalizeRequestId,
  normalizeActionId: js.normalizeActionId,
  normalizeJobId: js.normalizeJobId,
  normalizeWorkflowId: js.normalizeWorkflowId,
  parseTraceparent: js.parseTraceparent,
  formatTraceparent: js.formatTraceparent,
  isValidTracestate: js.isValidTracestate,
  sanitizeHeaderValue: js.sanitizeHeaderValue,
  parseBaggage: js.parseBaggage,
  formatBaggage: js.formatBaggage,
  shouldSample: js.shouldSample,
  redactJson: (json, extraKeys = []) => js.redactJson(json, extraKeys),
};

let nativeBinding: NativeApi | null = null;
let nativeChecked = false;

function loadNative(): NativeApi | null {
  if (nativeChecked) return nativeBinding;
  nativeChecked = true;
  try {
    const require = createRequire(__filename);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeBinding = require('../native/tracekit.node') as NativeApi;
  } catch {
    nativeBinding = null;
  }
  return nativeBinding;
}

export function core(): NativeApi {
  return loadNative() ?? jsFallback;
}

export function isNativeAvailable(): boolean {
  return loadNative() !== null;
}

export { jsFallback };

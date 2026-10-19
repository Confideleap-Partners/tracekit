/**
 * Native binding loader with a TypeScript fallback.
 *
 * The Rust native addon is the primary implementation. Resolution order:
 *
 * 1. `native/tracekit.node` — local build (`npm run build:native`)
 * 2. `tracekit.<platform-tag>.node` — napi-rs CLI output
 * 3. `@confideleap/tracekit-<platform-tag>` — published platform package
 *
 * The TypeScript fallback exists for unsupported platforms and emergency
 * rollback. It is never silent: a warning is emitted once, and
 * `TRACEKIT_REQUIRE_NATIVE=true` makes a missing native binding fatal.
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

export interface NativeStatus {
  available: boolean;
  loadedFrom: string | null;
  fallbackReason: string | null;
  platform: string;
  arch: string;
  libc: 'musl' | 'glibc' | 'unknown';
}

let nativeBinding: NativeApi | null = null;
let nativeChecked = false;
let nativePath: string | null = null;
let nativeError: string | null = null;
let fallbackWarned = false;
let loggedFallback = false;

function isMusl(): boolean {
  try {
    // Node 24 exposes glibc in the diagnostic report; absence means musl.
    const report = process.report?.getReport() as
      { header?: { glibcVersionRuntime?: string } } | undefined;
    return !report?.header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

function libc(): 'musl' | 'glibc' | 'unknown' {
  if (process.platform !== 'linux') return 'unknown';
  return isMusl() ? 'musl' : 'glibc';
}

function platformTag(): string | null {
  const { platform, arch } = process;
  if (platform === 'linux') return `linux-${arch}-${libc() === 'musl' ? 'musl' : 'gnu'}`;
  if (platform === 'darwin') return `darwin-${arch}`;
  if (platform === 'win32') return `win32-${arch}-msvc`;
  return null;
}

function nativeCandidates(): string[] {
  const candidates = ['../native/tracekit.node'];
  const tag = platformTag();
  if (tag) {
    candidates.push(`../tracekit.${tag}.node`);
    candidates.push(`@confideleap/tracekit-${tag}`);
  }
  return candidates;
}

function requireNative(candidate: string): NativeApi {
  const require = createRequire(__filename);
  return require(candidate) as NativeApi;
}

function loadNative(): NativeApi | null {
  if (nativeChecked) return nativeBinding;
  nativeChecked = true;

  for (const candidate of nativeCandidates()) {
    try {
      nativeBinding = requireNative(candidate);
      nativePath = candidate;
      nativeError = null;
      return nativeBinding;
    } catch (err) {
      nativeError = err instanceof Error ? err.message : String(err);
    }
  }

  if (process.env.TRACEKIT_REQUIRE_NATIVE === 'true') {
    throw new Error(
      `TraceKit: native binding is required but could not be loaded (${nativeError ?? 'unknown error'})`,
    );
  }
  return null;
}

function warnFallbackOnce(): void {
  if (fallbackWarned || process.env.NODE_ENV === 'test') return;
  fallbackWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[tracekit] native binding unavailable (${nativeError ?? 'unknown error'}); using TypeScript fallback. Set TRACEKIT_REQUIRE_NATIVE=true to fail fast.`,
  );
}

/** Primary core accessor. Returns the native binding when available. */
export function core(): NativeApi {
  const native = loadNative();
  if (native) return native;
  if (!loggedFallback) {
    loggedFallback = true;
    warnFallbackOnce();
  }
  return jsFallback;
}

export function isNativeAvailable(): boolean {
  return loadNative() !== null;
}

export function getNativeStatus(): NativeStatus {
  loadNative();
  return {
    available: nativeBinding !== null,
    loadedFrom: nativePath,
    fallbackReason: nativeBinding === null ? nativeError : null,
    platform: process.platform,
    arch: process.arch,
    libc: libc(),
  };
}

export { jsFallback };

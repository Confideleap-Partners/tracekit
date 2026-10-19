/**
 * Pure TypeScript fallback for the Rust core.
 *
 * Behaviour must stay aligned with `crates/core`. The contract tests run the
 * same vectors against this implementation and the native binding.
 */

import { randomBytes } from 'node:crypto';
import type { BaggageItem, TraceParent } from './types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LEN = 26;
const MAX_HEADER_BYTES = 1024;
const MAX_STRING_BYTES = 4096;
const RANDOM_MASK = (1n << 80n) - 1n;

const BAGGAGE_MAX_BYTES = 8192;
const BAGGAGE_MAX_MEMBERS = 180;
const TRACESTATE_MAX_MEMBERS = 32;
const TRACESTATE_MAX_BYTES = 512;

const DEFAULT_REDACT_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'setcookie',
  'password',
  'passwd',
  'passkey',
  'secret',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'session_token',
  'sessiontoken',
  'api_key',
  'apikey',
  'private_key',
  'privatekey',
  'otp',
  'mfa_code',
  'mfacode',
  'totp',
  'credit_card',
  'creditcard',
  'card_number',
  'cardnumber',
  'cvv',
];

const REDACTED = '[REDACTED]';

let lastMs = 0;
let lastRand = 0n;
let lastV7Ms = 0;
let lastV7Tail = 0n;

const UUIDV7_TAIL_MASK = (1n << 74n) - 1n;

function randomU128(): bigint {
  let value = BigInt(`0x${randomBytes(16).toString('hex')}`);
  if (value === 0n) value = 1n;
  return value;
}

function nowMs(): number {
  return Date.now();
}

function encodeTime(ms: number): string {
  let value = BigInt(ms);
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out = CROCKFORD[Number(value & 0x1fn)] + out;
    value >>= 5n;
  }
  return out;
}

function encodeRandom(rand: bigint): string {
  let value = rand;
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out = CROCKFORD[Number(value & 0x1fn)] + out;
    value >>= 5n;
  }
  return out;
}

export function newUlid(): string {
  const now = nowMs();
  let timestamp: number;
  let rand: bigint;
  if (now > lastMs) {
    timestamp = now;
    rand = randomU128() & RANDOM_MASK;
  } else {
    timestamp = lastMs;
    rand = (lastRand + 1n) & RANDOM_MASK;
  }
  lastMs = timestamp;
  lastRand = rand;
  return `${encodeTime(timestamp)}${encodeRandom(rand)}`;
}

/** Generate a monotonic UUIDv7 canonical string. */
export function newUuidV7(): string {
  const now = nowMs();
  let timestamp: number;
  let tail: bigint;
  if (now > lastV7Ms) {
    timestamp = now;
    tail = randomU128() & UUIDV7_TAIL_MASK;
  } else {
    timestamp = lastV7Ms;
    tail = (lastV7Tail + 1n) & UUIDV7_TAIL_MASK;
  }
  lastV7Ms = timestamp;
  lastV7Tail = tail;

  const ts = BigInt(timestamp) & 0xffffffffffffn;
  const high = (ts >> 16n).toString(16).padStart(8, '0');
  const mid = (ts & 0xffffn).toString(16).padStart(4, '0');
  const randA = ((tail >> 62n) & 0xfffn).toString(16).padStart(3, '0');
  const randB = tail & ((1n << 62n) - 1n);
  const group4 = (0x8000n | ((randB >> 48n) & 0x3fffn)).toString(16).padStart(4, '0');
  const group5 = (randB & 0xffffffffffffn).toString(16).padStart(12, '0');
  return `${high}-${mid}-7${randA}-${group4}-${group5}`;
}

export function isValidUuidV7(value: string): boolean {
  return parseUuidV7(value) !== null;
}

function parseUuidV7(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length !== 36) return null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (ch !== '-') return null;
    } else if (!/[0-9a-fA-F]/.test(ch)) {
      return null;
    }
  }
  const lower = trimmed.toLowerCase();
  if (lower[14] !== '7') return null;
  if (!/[89ab]/.test(lower[19])) return null;
  return lower;
}

function crockfordIndex(ch: string): number {
  return CROCKFORD.indexOf(ch.toUpperCase());
}

export function isValidUlid(value: string): boolean {
  if (value.length !== ULID_LEN) return false;
  for (const ch of value) {
    if (crockfordIndex(ch) < 0) return false;
  }
  return crockfordIndex(value[0]) <= 7;
}

function normalizeUlidPrefixed(value: string, prefix: string): string | null {
  if (!isValidUlid(value)) return null;
  return `${prefix}${value.toUpperCase()}`;
}

export function normalizeRequestId(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('cp_')) {
    const body = trimmed.slice(3);
    const uuid = parseUuidV7(body);
    if (uuid) return `cp_${uuid}`;
    return normalizeUlidPrefixed(body, 'cp_');
  }
  if (trimmed.startsWith('req_')) {
    return normalizeUlidPrefixed(trimmed.slice(4), 'req_');
  }
  const uuid = parseUuidV7(trimmed);
  if (uuid) return `cp_${uuid}`;
  return normalizeUlidPrefixed(trimmed, 'cp_');
}

export function normalizeActionId(value: string): string | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith('act_') ? trimmed.slice(4) : trimmed;
  const uuid = parseUuidV7(candidate);
  if (uuid) return `act_${uuid}`;
  return normalizeUlidPrefixed(candidate, 'act_');
}

export function normalizeJobId(value: string): string | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith('job_') ? trimmed.slice(4) : trimmed;
  const uuid = parseUuidV7(candidate);
  if (uuid) return `job_${uuid}`;
  return normalizeUlidPrefixed(candidate, 'job_');
}

export function newRequestId(): string {
  return `cp_${newUlid()}`;
}

export function newActionId(): string {
  return `act_${newUlid()}`;
}

export function newJobId(): string {
  return `job_${newUlid()}`;
}

export function newWorkflowId(): string {
  return `workflow_${newUlid()}`;
}

export function normalizeWorkflowId(value: string): string | null {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith('workflow_') ? trimmed.slice(9) : trimmed;
  const uuid = parseUuidV7(candidate);
  if (uuid) return `workflow_${uuid}`;
  return normalizeUlidPrefixed(candidate, 'workflow_');
}

export function newTraceId(): string {
  const value = randomU128();
  return value.toString(16).padStart(32, '0');
}

export function newSpanId(): string {
  const value = BigInt(`0x${randomBytes(8).toString('hex')}`);
  return (value === 0n ? 1n : value).toString(16).padStart(16, '0');
}

function isLowerHex(value: string, len: number): boolean {
  return value.length === len && /^[0-9a-f]+$/.test(value);
}

function isZeroHex(value: string): boolean {
  return /^0+$/.test(value);
}

export function parseTraceparent(value: string): TraceParent | null {
  const trimmed = value.trim();
  if (trimmed.length < 55) return null;
  const parts = trimmed.split('-');
  const [version, traceId, spanId, flags, ...rest] = parts;
  if (!version || !traceId || !spanId || flags === undefined) return null;
  if (version.length !== 2 || version === 'ff' || !/^[0-9a-f]{2}$/.test(version)) return null;
  if (version === '00' && (rest.length > 0 || trimmed.length !== 55)) return null;
  if (!isLowerHex(traceId, 32) || isZeroHex(traceId)) return null;
  if (!isLowerHex(spanId, 16) || isZeroHex(spanId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;
  return { traceId, spanId, flags: parseInt(flags, 16) };
}

export function formatTraceparent(traceId: string, spanId: string, flags: number): string | null {
  if (!isLowerHex(traceId, 32) || isZeroHex(traceId)) return null;
  if (!isLowerHex(spanId, 16) || isZeroHex(spanId)) return null;
  const flagHex = (flags & 0xff).toString(16).padStart(2, '0');
  return `00-${traceId}-${spanId}-${flagHex}`;
}

export function isValidTracestate(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > TRACESTATE_MAX_BYTES) return false;
  const members = trimmed.split(',').map((member) => member.trim());
  if (members.length > TRACESTATE_MAX_MEMBERS) return false;
  for (const member of members) {
    const index = member.indexOf('=');
    if (index <= 0) return false;
    const key = member.slice(0, index).trim();
    const val = member.slice(index + 1).trim();
    if (!key || !val || key.length > 256 || val.length > 256) return false;
    if (/\s/.test(key) || /\s/.test(val)) return false;
  }
  return true;
}

export function sanitizeHeaderValue(value: string): string | null {
  const cleaned = Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim();
  if (!cleaned || cleaned.length > MAX_HEADER_BYTES) return null;
  return cleaned;
}

function isTokenChar(ch: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+\-.^_`|~]$/.test(ch);
}

function percentDecode(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '%' && i + 2 < value.length) {
      const hex = value.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(value.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString('utf8');
}

function percentEncode(value: string): string {
  return Array.from(Buffer.from(value, 'utf8'))
    .map((byte) => {
      const ch = String.fromCharCode(byte);
      if (/^[A-Za-z0-9\-._~]$/.test(ch)) return ch;
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

export function parseBaggage(value: string): BaggageItem[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > BAGGAGE_MAX_BYTES) return [];
  const items: BaggageItem[] = [];
  for (const rawMember of trimmed.split(',')) {
    if (items.length >= BAGGAGE_MAX_MEMBERS) break;
    const member = rawMember.split(';')[0]?.trim() ?? '';
    if (!member) continue;
    const index = member.indexOf('=');
    if (index <= 0) continue;
    const key = member.slice(0, index).trim();
    const rawValue = member.slice(index + 1).trim();
    if (!key || !Array.from(key).every(isTokenChar)) continue;
    items.push({ key, value: percentDecode(rawValue) });
  }
  return items;
}

export function formatBaggage(items: BaggageItem[]): string | null {
  if (items.length > BAGGAGE_MAX_MEMBERS) return null;
  const encoded: string[] = [];
  let total = 0;
  for (const item of items) {
    if (!item.key || !Array.from(item.key).every(isTokenChar)) return null;
    const member = `${item.key}=${percentEncode(item.value)}`;
    total += member.length + (encoded.length ? 1 : 0);
    if (total > BAGGAGE_MAX_BYTES) return null;
    encoded.push(member);
  }
  return encoded.join(',');
}

export function shouldSample(traceId: string, ratio: number): boolean {
  if (ratio >= 1) return true;
  if (ratio <= 0) return false;
  if (traceId.length < 8) return false;
  const bucket = parseInt(traceId.slice(0, 8), 16);
  if (Number.isNaN(bucket)) return false;
  const threshold = Math.floor(ratio * 0xffffffff);
  return bucket <= threshold;
}

function isSensitiveKey(key: string, extraKeys: string[]): boolean {
  const lower = key.toLowerCase();
  return (
    DEFAULT_REDACT_KEYS.includes(lower) ||
    extraKeys.some((candidate) => candidate.toLowerCase() === lower)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function redactValue(value: any, extraKeys: string[]): any {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, extraKeys));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSensitiveKey(key, extraKeys) ? REDACTED : redactValue(child, extraKeys);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_STRING_BYTES) {
    return `${value.slice(0, MAX_STRING_BYTES)}...[truncated]`;
  }
  return value;
}

export function redactJson(json: string, extraKeys: string[] = []): string | null {
  try {
    const parsed = JSON.parse(json);
    return JSON.stringify(redactValue(parsed, extraKeys));
  } catch {
    return null;
  }
}

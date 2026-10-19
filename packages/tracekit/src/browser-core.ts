/**
 * Browser-safe core: ID generation and trace header validation using Web
 * Crypto. This module must not import any Node built-in so it can be bundled
 * for frontend applications.
 */

import type { IdFormat } from './types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LEN = 26;
const RANDOM_MASK = (1n << 80n) - 1n;
const UUIDV7_TAIL_MASK = (1n << 74n) - 1n;

let lastUlidMs = 0;
let lastUlidRand = 0n;
let lastV7Ms = 0;
let lastV7Tail = 0n;

function webCrypto(): Crypto | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) {
      return globalThis.crypto as Crypto;
    }
  } catch {
    // ignore
  }
  return null;
}

export function isWebCryptoAvailable(): boolean {
  return typeof webCrypto()?.getRandomValues === 'function';
}

function randomBytes(length: number): Uint8Array {
  const crypto = webCrypto();
  const buffer = new Uint8Array(length);
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(buffer);
    return buffer;
  }
  // Last-resort fallback. Web Crypto is available in all supported browsers.
  for (let i = 0; i < length; i += 1) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
}

function randomU128(): bigint {
  let value = 0n;
  for (const byte of randomBytes(16)) {
    value = (value << 8n) | BigInt(byte);
  }
  return value === 0n ? 1n : value;
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

export function newBrowserUlid(): string {
  const now = Date.now();
  let timestamp: number;
  let rand: bigint;
  if (now > lastUlidMs) {
    timestamp = now;
    rand = randomU128() & RANDOM_MASK;
  } else {
    timestamp = lastUlidMs;
    rand = (lastUlidRand + 1n) & RANDOM_MASK;
  }
  lastUlidMs = timestamp;
  lastUlidRand = rand;
  return `${encodeTime(timestamp)}${encodeRandom(rand)}`;
}

export function newBrowserUuidV7(): string {
  const now = Date.now();
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

export function generateBrowserIdBody(format: IdFormat): string {
  return format === 'ulid' ? newBrowserUlid() : newBrowserUuidV7();
}

export function isValidBrowserUlid(value: string): boolean {
  if (value.length !== ULID_LEN) return false;
  for (const ch of value) {
    if (CROCKFORD.indexOf(ch.toUpperCase()) < 0) return false;
  }
  return CROCKFORD.indexOf(value[0].toUpperCase()) <= 7;
}

function parseBrowserUuidV7(value: string): string | null {
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

function normalizeUlidBody(value: string, prefix: string): string | null {
  if (!isValidBrowserUlid(value)) return null;
  return `${prefix}${value.toUpperCase()}`;
}

/**
 * Normalize `cp_<ULID>`, `cp_<UUIDv7>`, or a legacy `req_<ULID>`.
 * New and bare IDs become canonical `cp_` IDs.
 */
export function normalizeBrowserRequestId(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('cp_')) {
    const body = trimmed.slice(3);
    const uuid = parseBrowserUuidV7(body);
    if (uuid) return `cp_${uuid}`;
    return normalizeUlidBody(body, 'cp_');
  }
  if (trimmed.startsWith('req_')) {
    return normalizeUlidBody(trimmed.slice(4), 'req_');
  }
  const uuid = parseBrowserUuidV7(trimmed);
  if (uuid) return `cp_${uuid}`;
  return normalizeUlidBody(trimmed, 'cp_');
}

export function normalizeBrowserActionId(value: string): string | null {
  const trimmed = value.trim();
  const body = trimmed.startsWith('act_') ? trimmed.slice(4) : trimmed;
  const uuid = parseBrowserUuidV7(body);
  if (uuid) return `act_${uuid}`;
  return normalizeUlidBody(body, 'act_');
}

export function isValidBrowserUuidV7(value: string): boolean {
  return parseBrowserUuidV7(value) !== null;
}

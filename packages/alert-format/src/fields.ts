import { compareBytes, type CborMap, type CborValue } from './cbor.js';
import { encodeUtf8 } from './utf8.js';

/** Raised when bytes are valid CBOR but do not match the Priedanga schema. */
export class FormatError extends Error {
  override name = 'FormatError';
}

export function fail(message: string): never {
  throw new FormatError(message);
}

export function asMap(value: CborValue, what: string): CborMap {
  if (!(value instanceof Map)) fail(`${what} must be a map`);
  return value;
}

export function asArray(value: CborValue, what: string): CborValue[] {
  if (!Array.isArray(value)) fail(`${what} must be an array`);
  return value;
}

/** Reject any map key not in the allowed set (no silent forward-compat in v1). */
export function rejectUnknownKeys(map: CborMap, allowed: Record<string, number>, what: string): void {
  const known = new Set<number>(Object.values(allowed));
  for (const key of map.keys()) {
    if (typeof key !== 'number' || !known.has(key)) fail(`${what}: unknown field ${String(key)}`);
  }
}

export function uint(value: CborValue | undefined, what: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number') fail(`${what} must be an unsigned integer`);
  if (value > max) fail(`${what} out of range`);
  return value;
}

export function bytes(value: CborValue | undefined, what: string, length?: number): Uint8Array {
  if (!(value instanceof Uint8Array)) fail(`${what} must be a byte string`);
  if (length !== undefined && value.length !== length) fail(`${what} must be ${length} bytes`);
  return value;
}

export function bool(value: CborValue | undefined, what: string): boolean {
  if (typeof value !== 'boolean') fail(`${what} must be a boolean`);
  return value;
}

export function text(value: CborValue | undefined, what: string, maxBytes: number): string {
  if (typeof value !== 'string') fail(`${what} must be a text string`);
  if (value.length === 0) fail(`${what} must not be empty`);
  if (encodeUtf8(value).length > maxBytes) fail(`${what} too long`);
  return value;
}

export function oneOf<T extends number>(value: number, allowed: Record<string, T>, what: string): T {
  if (!(Object.values(allowed) as number[]).includes(value)) fail(`${what}: invalid value ${value}`);
  return value as T;
}

/** Validate a sorted, unique, non-empty area list; NATIONWIDE (0) must appear alone. */
export function validateAreas(areas: readonly number[], what: string, maxCode: number, nationwide: number): void {
  if (areas.length === 0) fail(`${what} must not be empty`);
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i]!;
    if (!Number.isInteger(a) || a < 0 || a > maxCode) fail(`${what}: invalid area code ${a}`);
    if (i > 0 && a <= areas[i - 1]!) fail(`${what} must be sorted ascending and unique`);
  }
  if (areas.includes(nationwide) && areas.length !== 1) fail(`${what}: nationwide must be the only area`);
}

/** Validate a sorted, unique list of fixed-length byte strings. */
export function validateSortedBytesList(list: readonly Uint8Array[], what: string, length: number): void {
  for (let i = 0; i < list.length; i++) {
    if (list[i]!.length !== length) fail(`${what}: entries must be ${length} bytes`);
    if (i > 0 && compareBytes(list[i - 1]!, list[i]!) >= 0) fail(`${what} must be sorted ascending and unique`);
  }
}

export function isTimestamp(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

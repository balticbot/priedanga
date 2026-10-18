/**
 * Minimal deterministic CBOR (RFC 8949) for the Priedanga wire format.
 *
 * Supported subset:
 *   - unsigned integers (major type 0), up to Number.MAX_SAFE_INTEGER
 *   - byte strings (2), text strings (3), arrays (4), maps (5)
 *   - false / true (simple values 20 / 21)
 *
 * The encoder always produces RFC 8949 §4.2.1 "core deterministic" encoding.
 * The decoder accepts ONLY that encoding and rejects everything else:
 * non-minimal lengths, indefinite lengths, unsorted or duplicate map keys,
 * negative integers, tags, floats, other simple values, invalid UTF-8 and
 * trailing bytes. As a result there is exactly one valid byte encoding of
 * every value, and decode(x) re-encodes to exactly x.
 */

import { decodeUtf8, encodeUtf8, Utf8Error } from './utf8.js';

export type CborMapKey = number | string;
export type CborValue = number | boolean | string | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<CborMapKey, CborValue>;

export class CborError extends Error {
  override name = 'CborError';
}

export interface DecodeLimits {
  /** Maximum nesting depth of arrays/maps. */
  maxDepth: number;
  /** Maximum total number of decoded items. */
  maxItems: number;
}

export const DEFAULT_DECODE_LIMITS: DecodeLimits = { maxDepth: 8, maxItems: 4096 };

const TWO_32 = 0x1_0000_0000;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Append a CBOR head (major type + argument) to `out`.
 * `width` forces a specific argument width; it exists only so that tests and
 * test-vector generators can build deliberately NON-canonical encodings.
 */
export function writeHead(out: number[], major: number, value: number, width?: 0 | 1 | 2 | 4 | 8): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CborError(`invalid CBOR argument: ${value}`);
  }
  const mt = major << 5;
  const w = width ?? (value < 24 ? 0 : value < 0x100 ? 1 : value < 0x10000 ? 2 : value < TWO_32 ? 4 : 8);
  switch (w) {
    case 0:
      if (value >= 24) throw new CborError('value too large for inline argument');
      out.push(mt | value);
      return;
    case 1:
      if (value >= 0x100) throw new CborError('value too large for 1-byte argument');
      out.push(mt | 24, value);
      return;
    case 2:
      if (value >= 0x10000) throw new CborError('value too large for 2-byte argument');
      out.push(mt | 25, value >> 8, value & 0xff);
      return;
    case 4:
      if (value >= TWO_32) throw new CborError('value too large for 4-byte argument');
      out.push(mt | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      return;
    case 8: {
      const hi = Math.floor(value / TWO_32);
      const lo = value >>> 0;
      out.push(
        mt | 27,
        (hi >>> 24) & 0xff,
        (hi >>> 16) & 0xff,
        (hi >>> 8) & 0xff,
        hi & 0xff,
        (lo >>> 24) & 0xff,
        (lo >>> 16) & 0xff,
        (lo >>> 8) & 0xff,
        lo & 0xff,
      );
      return;
    }
  }
}

function encodeInto(out: number[], value: CborValue): void {
  if (typeof value === 'number') {
    writeHead(out, 0, value);
  } else if (typeof value === 'boolean') {
    out.push(value ? 0xf5 : 0xf4);
  } else if (typeof value === 'string') {
    let bytes: Uint8Array;
    try {
      bytes = encodeUtf8(value);
    } catch (e) {
      throw new CborError(e instanceof Utf8Error ? e.message : 'invalid string');
    }
    writeHead(out, 3, bytes.length);
    for (const b of bytes) out.push(b);
  } else if (value instanceof Uint8Array) {
    writeHead(out, 2, value.length);
    for (const b of value) out.push(b);
  } else if (Array.isArray(value)) {
    writeHead(out, 4, value.length);
    for (const item of value) encodeInto(out, item);
  } else if (value instanceof Map) {
    const entries: { key: Uint8Array; val: Uint8Array }[] = [];
    for (const [k, v] of value) {
      if (!(typeof k === 'string' || (typeof k === 'number' && Number.isSafeInteger(k) && k >= 0))) {
        throw new CborError(`unsupported map key: ${String(k)}`);
      }
      entries.push({ key: encode(k), val: encode(v) });
    }
    entries.sort((a, b) => compareBytes(a.key, b.key));
    for (let i = 1; i < entries.length; i++) {
      if (compareBytes(entries[i - 1]!.key, entries[i]!.key) === 0) {
        throw new CborError('duplicate map key');
      }
    }
    writeHead(out, 5, entries.length);
    for (const { key, val } of entries) {
      for (const b of key) out.push(b);
      for (const b of val) out.push(b);
    }
  } else {
    throw new CborError(`unsupported value type: ${typeof value}`);
  }
}

/** Encode a value using deterministic CBOR. */
export function encode(value: CborValue): Uint8Array {
  const out: number[] = [];
  encodeInto(out, value);
  return Uint8Array.from(out);
}

/** Bytewise lexicographic comparison (shorter prefix sorts first). */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

class Reader {
  pos = 0;
  items = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: DecodeLimits,
  ) {}

  private byte(): number {
    const b = this.bytes[this.pos];
    if (b === undefined) throw new CborError('unexpected end of input');
    this.pos++;
    return b;
  }

  private take(n: number): Uint8Array {
    if (n > this.bytes.length - this.pos) throw new CborError('length exceeds remaining input');
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Read a head and return [major, argument], enforcing minimal encoding. */
  private head(): [number, number] {
    const ib = this.byte();
    const major = ib >> 5;
    const ai = ib & 0x1f;
    if (major === 7) {
      // Simple values / floats: only false (20) and true (21) are allowed.
      if (ai === 20 || ai === 21) return [7, ai];
      throw new CborError(`unsupported simple value or float (0x${ib.toString(16)})`);
    }
    if (ai < 24) return [major, ai];
    if (ai === 24) {
      const v = this.byte();
      if (v < 24) throw new CborError('non-minimal integer encoding');
      return [major, v];
    }
    if (ai === 25) {
      const v = (this.byte() << 8) | this.byte();
      if (v < 0x100) throw new CborError('non-minimal integer encoding');
      return [major, v];
    }
    if (ai === 26) {
      const v = ((this.byte() << 24) >>> 0) + (this.byte() << 16) + (this.byte() << 8) + this.byte();
      if (v < 0x10000) throw new CborError('non-minimal integer encoding');
      return [major, v];
    }
    if (ai === 27) {
      let hi = 0;
      for (let i = 0; i < 4; i++) hi = hi * 256 + this.byte();
      let lo = 0;
      for (let i = 0; i < 4; i++) lo = lo * 256 + this.byte();
      if (hi === 0) throw new CborError('non-minimal integer encoding');
      const v = hi * TWO_32 + lo;
      if (!Number.isSafeInteger(v)) throw new CborError('integer exceeds safe range');
      return [major, v];
    }
    if (ai === 31) throw new CborError('indefinite-length encoding not allowed');
    throw new CborError(`reserved additional information value ${ai}`);
  }

  item(depth: number): CborValue {
    if (++this.items > this.limits.maxItems) throw new CborError('too many items');
    const [major, arg] = this.head();
    switch (major) {
      case 0:
        return arg;
      case 1:
        throw new CborError('negative integers not supported');
      case 2:
        return this.take(arg);
      case 3:
        try {
          return decodeUtf8(this.take(arg));
        } catch (e) {
          if (e instanceof Utf8Error) throw new CborError(`invalid text string: ${e.message}`);
          throw e;
        }
      case 4: {
        if (depth >= this.limits.maxDepth) throw new CborError('nesting too deep');
        if (arg > this.bytes.length - this.pos) throw new CborError('array length exceeds remaining input');
        const arr: CborValue[] = [];
        for (let i = 0; i < arg; i++) arr.push(this.item(depth + 1));
        return arr;
      }
      case 5: {
        if (depth >= this.limits.maxDepth) throw new CborError('nesting too deep');
        if (arg * 2 > this.bytes.length - this.pos) throw new CborError('map length exceeds remaining input');
        const map: CborMap = new Map();
        let prevKey: Uint8Array | undefined;
        for (let i = 0; i < arg; i++) {
          const keyStart = this.pos;
          const key = this.item(depth + 1);
          const keyBytes = this.bytes.subarray(keyStart, this.pos);
          if (typeof key !== 'number' && typeof key !== 'string') {
            throw new CborError('map keys must be unsigned integers or text strings');
          }
          if (prevKey !== undefined && compareBytes(prevKey, keyBytes) >= 0) {
            throw new CborError('map keys not in canonical order or duplicated');
          }
          prevKey = keyBytes;
          map.set(key, this.item(depth + 1));
        }
        return map;
      }
      case 6:
        throw new CborError('tags not supported');
      case 7:
        return arg === 21;
      default:
        throw new CborError('unreachable');
    }
  }

  get done(): boolean {
    return this.pos === this.bytes.length;
  }
}

/** Decode exactly one deterministic-CBOR item; rejects any other encoding. */
export function decode(bytes: Uint8Array, limits: DecodeLimits = DEFAULT_DECODE_LIMITS): CborValue {
  const r = new Reader(bytes, limits);
  const value = r.item(0);
  if (!r.done) throw new CborError('trailing bytes after CBOR item');
  return value;
}

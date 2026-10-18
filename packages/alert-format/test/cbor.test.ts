import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { CborError, decode, encode, type CborValue } from '../src/cbor.js';
import { decodeUtf8, encodeUtf8, Utf8Error } from '../src/utf8.js';

const h = (s: string) => hexToBytes(s.replace(/\s+/g, ''));

describe('cbor encode (RFC 8949 deterministic)', () => {
  it.each<[CborValue, string]>([
    [0, '00'],
    [23, '17'],
    [24, '1818'],
    [255, '18ff'],
    [256, '190100'],
    [65535, '19ffff'],
    [65536, '1a00010000'],
    [4294967295, '1affffffff'],
    [4294967296, '1b0000000100000000'],
    [Number.MAX_SAFE_INTEGER, '1b001fffffffffffff'],
    [false, 'f4'],
    [true, 'f5'],
    ['', '60'],
    ['a', '6161'],
    [new Uint8Array([1, 2, 3]), '43010203'],
    [[1, [2, 3]], '8201820203'],
  ])('encodes %o as %s', (value, hex) => {
    expect(bytesToHex(encode(value))).toBe(hex);
  });

  it('sorts map keys bytewise by encoded key (ints before text, shorter first)', () => {
    const m = new Map<number | string, CborValue>([
      ['b', 1],
      [100, 2],
      [1, 3],
      ['a', 4],
      [10, 5],
    ]);
    // keys: 01, 0a, 1864, 6161, 6162
    expect(bytesToHex(encode(m))).toBe('a5' + '0103' + '0a05' + '186402' + '616104' + '616201');
  });

  it('rejects unsupported values', () => {
    expect(() => encode(-1)).toThrow(CborError);
    expect(() => encode(1.5)).toThrow(CborError);
    expect(() => encode(Number.MAX_SAFE_INTEGER + 1)).toThrow(CborError);
    expect(() => encode('\ud800')).toThrow(CborError);
    expect(() => encode(new Map([[-1, 1]]) as never)).toThrow(CborError);
  });
});

describe('cbor decode (strict)', () => {
  it('round-trips nested values and re-encodes to identical bytes', () => {
    const value: CborValue = new Map<number | string, CborValue>([
      [0, 1],
      [1, new Uint8Array(16).fill(7)],
      [2, [0, 13, 255, 256, 70000]],
      [3, true],
      ['lt', 'Oro pavojus — ąčęėįšųūž'],
      ['uk', 'Повітряна тривога'],
    ]);
    const bytes = encode(value);
    const decoded = decode(bytes);
    expect(decoded).toEqual(value);
    expect(encode(decoded)).toEqual(bytes);
  });

  it.each([
    ['non-minimal 1-byte int', '1817'],
    ['non-minimal 2-byte int', '1900ff'],
    ['non-minimal 4-byte int', '1a0000ffff'],
    ['non-minimal 8-byte int', '1b00000000ffffffff'],
    ['non-minimal length', '5801ff'],
    ['negative integer', '20'],
    ['tag', 'c000'],
    ['float', 'f93c00'],
    ['null', 'f6'],
    ['undefined', 'f7'],
    ['indefinite array', '9f01ff'],
    ['indefinite bytes', '5f4101ff'],
    ['reserved additional info', '1c'],
    ['truncated', '1901'],
    ['trailing bytes', '0000'],
    ['length beyond input', '45010203'],
    ['unsorted map keys', 'a2' + '0101' + '0000'],
    ['duplicate map keys', 'a2' + '0001' + '0002'],
    ['non-int/text map key', 'a1' + 'f5' + '00'],
    ['invalid utf-8', '62c328'],
    ['overlong utf-8', '62c0af'],
    ['utf-8 surrogate', '63eda080'],
    ['empty input', ''],
  ])('rejects %s', (_name, hex) => {
    expect(() => decode(h(hex))).toThrow(CborError);
  });

  it('enforces nesting depth', () => {
    const deep = '81'.repeat(9) + '00';
    expect(() => decode(h(deep))).toThrow(/nesting/);
    expect(() => decode(h('81'.repeat(8) + '00'))).not.toThrow();
  });

  it('enforces item limit', () => {
    const arr = new Array(5000).fill(0);
    expect(() => decode(encode(arr))).toThrow(/too many items/);
  });

  it('rejects array counts larger than remaining input before allocating', () => {
    expect(() => decode(h('9bffffffffffffffff'))).toThrow(CborError);
  });
});

describe('utf8', () => {
  it('round-trips multilingual text', () => {
    for (const s of ['', 'abc', 'Šiauliai', 'Воздушная тревога', 'Повітряна', '🛡️ shelter']) {
      expect(decodeUtf8(encodeUtf8(s))).toBe(s);
    }
  });

  it('rejects malformed sequences', () => {
    for (const hex of ['80', 'c3', 'e282', 'f09f98', 'c0af', 'e080af', 'eda080', 'f4908080', 'f8']) {
      expect(() => decodeUtf8(h(hex)), hex).toThrow(Utf8Error);
    }
  });
});

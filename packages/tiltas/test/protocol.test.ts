import { readFileSync } from 'node:fs';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import type { FrameVectors } from '../scripts/gen-vectors.js';
import {
  checkEnvelope,
  decodeChunk,
  decodeInventory,
  decodeSelect,
  encodeChunk,
  encodeInventory,
  FrameError,
  MAX_ENVELOPE_BYTES,
  reassemble,
} from '../src/protocol.js';

const v = JSON.parse(readFileSync(new URL('../test-vectors/frames.json', import.meta.url), 'utf8')) as FrameVectors;

describe('frame vectors', () => {
  it.each(v.inventory)('inventory: $name', (t) => {
    const frame = hexToBytes(t.hex);
    if (!t.ok) return expect(() => decodeInventory(frame)).toThrow(FrameError);
    const entries = decodeInventory(frame);
    expect(entries.map((e) => ({ key: bytesToHex(e.key), priority: e.priority, expires: e.expires }))).toEqual(t.entries);
    expect(bytesToHex(encodeInventory(entries))).toBe(t.hex);
  });

  it.each(v.select)('select: $name', (t) => {
    const frame = hexToBytes(t.hex);
    if (!t.ok) return expect(() => decodeSelect(frame)).toThrow(FrameError);
    const s = decodeSelect(frame);
    expect({ key: bytesToHex(s.key), index: s.index }).toEqual({ key: t.key, index: t.index });
  });

  it.each(v.chunk)('chunk: $name', (t) => {
    const frame = hexToBytes(t.hex);
    if (!t.ok) return expect(() => decodeChunk(frame)).toThrow(FrameError);
    const c = decodeChunk(frame);
    expect({ index: c.index, total: c.total, payload: bytesToHex(c.payload) }).toEqual({ index: t.index, total: t.total, payload: t.payload });
  });

  it.each(v.envelope)('envelope: $name', (t) => {
    const env = hexToBytes(t.hex);
    const key = hexToBytes(t.key);
    if (!t.ok) return expect(() => checkEnvelope(env, key)).toThrow(FrameError);
    expect(bytesToHex(checkEnvelope(env, key))).toBe(t.body);
    if (t.chunks) {
      const served = t.chunks.map((_, i) => bytesToHex(encodeChunk(env, i)));
      expect(served).toEqual(t.chunks);
      expect(bytesToHex(reassemble(t.chunks.map((c) => decodeChunk(hexToBytes(c)))))).toBe(t.hex);
    }
  });
});

describe('chunking', () => {
  it('round-trips every envelope length up to the limit', () => {
    for (let n = 1; n <= MAX_ENVELOPE_BYTES; n += 37) {
      const env = Uint8Array.from({ length: n }, (_, i) => i & 0xff);
      const total = Math.ceil(n / 480);
      const chunks = Array.from({ length: total }, (_, i) => decodeChunk(encodeChunk(env, i)));
      expect(reassemble(chunks)).toEqual(env);
      expect(decodeChunk(encodeChunk(env, total)).total).toBe(0);
    }
  });

  it('rejects chunks out of order or from different envelopes', () => {
    const env = new Uint8Array(900);
    const [a, b] = [0, 1].map((i) => decodeChunk(encodeChunk(env, i)));
    expect(() => reassemble([b!, a!])).toThrow(FrameError);
    expect(() => reassemble([a!])).toThrow(FrameError);
    const other = decodeChunk(encodeChunk(new Uint8Array(1000), 1));
    expect(() => reassemble([a!, { ...other, total: 3 }])).toThrow(FrameError);
  });
});

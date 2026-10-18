/**
 * Writes test-vectors/frames.json: Tiltas frames and envelope checks with the
 * expected result. Every implementation (TypeScript, Swift, Kotlin) must agree.
 * Run: npm run vectors -w @priedanga/tiltas
 */

import { writeFileSync } from 'node:fs';
import { bytesToHex } from '@noble/hashes/utils.js';
import { decodeAlertEnvelope, encodeAlertEnvelope } from '@priedanga/alert-format';
import { alert } from '../test/fixtures.js';
import { encodeChunk, encodeInventory, encodeSelect, meshKey } from '../src/protocol.js';

export interface FrameVectors {
  description: string;
  inventory: { name: string; hex: string; ok: boolean; entries?: { key: string; priority: number; expires: number }[] }[];
  select: { name: string; hex: string; ok: boolean; key?: string; index?: number }[];
  chunk: { name: string; hex: string; ok: boolean; index?: number; total?: number; payload?: string }[];
  /** Envelope checks: `key` is the requested key. `chunks` = the CHUNK frames a peripheral serves for it. */
  envelope: { name: string; hex: string; key: string; ok: boolean; body?: string; chunks?: string[] }[];
}

const h = bytesToHex;
const k = (n: number) => new Uint8Array(8).fill(n);

const small = alert();
const big = alert({ text: 'Š'.repeat(300) }); // ~750-byte envelope: two chunks
const env = decodeAlertEnvelope(small);
const bigEnv = decodeAlertEnvelope(big);
const chunksOf = (e: Uint8Array) => Array.from({ length: Math.ceil(e.length / 480) }, (_, i) => h(encodeChunk(e, i)));

const inv = encodeInventory([
  { key: k(1), priority: 3, expires: 1_800_003_600 },
  { key: k(2), priority: 1, expires: 1_800_000_100 },
]);
const tweak = (b: Uint8Array, at: number, v: number) => {
  const c = b.slice();
  c[at] = v;
  return c;
};
const longBody = encodeAlertEnvelope({ body: new Uint8Array(30), signature: new Uint8Array(64), hops: 0 });

const vectors: FrameVectors = {
  description: 'Tiltas v1 frame vectors (packages/tiltas/SPEC.md). Hex strings; ok=false means the frame must be rejected.',
  inventory: [
    { name: 'empty', hex: '0100', ok: true, entries: [] },
    {
      name: 'two entries, sorted by priority',
      hex: h(inv),
      ok: true,
      entries: [
        { key: h(k(1)), priority: 3, expires: 1_800_003_600 },
        { key: h(k(2)), priority: 1, expires: 1_800_000_100 },
      ],
    },
    { name: 'wrong version', hex: h(tweak(inv, 0, 2)), ok: false },
    { name: 'count larger than data', hex: h(tweak(inv, 1, 3)), ok: false },
    { name: 'trailing byte', hex: h(inv) + '00', ok: false },
    { name: 'priority 4', hex: h(tweak(inv, 2 + 8, 4)), ok: false },
    { name: 'duplicate key', hex: '0102' + (h(k(1)) + '03' + '6b49e710').repeat(2), ok: false },
    { name: 'count 33', hex: '0121' + (h(k(9)) + '00' + '00000001').repeat(33), ok: false },
    { name: 'empty frame', hex: '', ok: false },
  ],
  select: [
    { name: 'chunk 0', hex: h(encodeSelect(k(7), 0)), ok: true, key: h(k(7)), index: 0 },
    { name: 'chunk 2', hex: h(encodeSelect(k(7), 2)), ok: true, key: h(k(7)), index: 2 },
    { name: 'index 3 (max chunks is 3)', hex: '01' + h(k(7)) + '03', ok: false },
    { name: 'short', hex: '01' + h(k(7)), ok: false },
    { name: 'wrong version', hex: '02' + h(k(7)) + '00', ok: false },
  ],
  chunk: [
    { name: 'not available', hex: '010000', ok: true, index: 0, total: 0, payload: '' },
    { name: 'single chunk', hex: '010001abcd', ok: true, index: 0, total: 1, payload: 'abcd' },
    { name: 'not available with payload', hex: '010000ff', ok: false },
    { name: 'index >= total', hex: '010101ab', ok: false },
    { name: 'total 4', hex: '010004ab', ok: false },
    { name: 'first of two but short', hex: '010002ab', ok: false },
    { name: 'empty last chunk', hex: '010001', ok: false },
    { name: 'last chunk too long', hex: '010001' + 'ab'.repeat(481), ok: false },
    { name: 'wrong version', hex: '000001ab', ok: false },
  ],
  envelope: [
    { name: 'valid alert, one chunk', hex: h(small), key: h(meshKey(env.body)), ok: true, body: h(env.body), chunks: chunksOf(small) },
    { name: 'valid alert, two chunks', hex: h(big), key: h(meshKey(bigEnv.body)), ok: true, body: h(bigEnv.body), chunks: chunksOf(big) },
    { name: 'hops changed: same key', hex: h(encodeAlertEnvelope({ body: env.body, signature: env.signature, hops: 9 })), key: h(meshKey(env.body)), ok: true, body: h(env.body) },
    { name: 'key mismatch', hex: h(small), key: h(k(1)), ok: false },
    { name: 'shape ok, arbitrary body', hex: h(longBody), key: h(meshKey(new Uint8Array(30))), ok: true, body: h(new Uint8Array(30)) },
    { name: 'trailing byte', hex: h(small) + '00', key: h(meshKey(env.body)), ok: false },
    { name: 'truncated', hex: h(small.slice(0, -1)), key: h(meshKey(env.body)), ok: false },
    { name: '3-item array', hex: '83' + h(small.slice(1)), key: h(meshKey(env.body)), ok: false },
    { name: 'signature 63 bytes', hex: '8401' + '4100' + '583f' + '00'.repeat(63) + '00', key: h(meshKey(Uint8Array.of(0))), ok: false },
    { name: 'non-shortest version', hex: '841801' + h(small.slice(2)), key: h(meshKey(env.body)), ok: false },
    { name: 'too large', hex: h(encodeAlertEnvelope({ body: new Uint8Array(1000), signature: new Uint8Array(64), hops: 0 })), key: h(meshKey(new Uint8Array(1000))), ok: false },
  ],
};

writeFileSync(new URL('../test-vectors/frames.json', import.meta.url), JSON.stringify(vectors, null, 2) + '\n');
console.log(`frames.json: ${vectors.inventory.length + vectors.select.length + vectors.chunk.length + vectors.envelope.length} vectors`);

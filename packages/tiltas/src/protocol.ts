/**
 * Tiltas v1 wire frames (SPEC.md §2). Pure functions, no I/O; mirrored by the
 * Swift implementation and pinned by test-vectors/frames.json.
 */

import { sha256 } from '@noble/hashes/sha2.js';

export const PROTOCOL_VERSION = 1;

export const SERVICE_UUID = '9E48E5B5-A636-4FC6-8312-05C46E541BEC';
export const INVENTORY_UUID = 'A247668E-46A8-48A7-A7F7-9C774346DC20';
export const SELECT_UUID = 'E6F3F542-B066-4CB9-B85D-01C4FA01E412';
export const CHUNK_UUID = '114CED89-DD83-444E-AF0B-C382940F1D4C';

export const KEY_BYTES = 8;
export const MAX_INVENTORY = 32;
export const MAX_ENVELOPE_BYTES = 1024;
export const CHUNK_PAYLOAD = 480;
export const MAX_CHUNKS = Math.ceil(MAX_ENVELOPE_BYTES / CHUNK_PAYLOAD);
export const MAX_PRIORITY = 3;
const ENTRY_BYTES = KEY_BYTES + 1 + 4;

export class FrameError extends Error {
  override name = 'FrameError';
}

export interface InventoryEntry {
  key: Uint8Array;
  priority: number;
  expires: number;
}

function fail(msg: string): never {
  throw new FrameError(msg);
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Mesh key: SHA-256 of the signed alert body, first 8 bytes (SPEC §1.2). */
export function meshKey(body: Uint8Array): Uint8Array {
  return sha256(body).slice(0, KEY_BYTES);
}

export const keyHex = hex;

/** Sort order shared by inventories and fetch plans: priority desc, expires desc, then key ascending. */
export function byUrgency(a: InventoryEntry, b: InventoryEntry): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.expires !== b.expires) return b.expires - a.expires;
  for (let i = 0; i < KEY_BYTES; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!;
  return 0;
}

export function encodeInventory(entries: readonly InventoryEntry[]): Uint8Array {
  if (entries.length > MAX_INVENTORY) fail('too many entries');
  const out = new Uint8Array(2 + ENTRY_BYTES * entries.length);
  const view = new DataView(out.buffer);
  out[0] = PROTOCOL_VERSION;
  out[1] = entries.length;
  const seen = new Set<string>();
  [...entries].sort(byUrgency).forEach((e, i) => {
    if (e.key.length !== KEY_BYTES) fail('bad key length');
    if (!Number.isInteger(e.priority) || e.priority < 0 || e.priority > MAX_PRIORITY) fail('bad priority');
    if (!Number.isInteger(e.expires) || e.expires < 0 || e.expires > 0xffffffff) fail('bad expires');
    const k = hex(e.key);
    if (seen.has(k)) fail('duplicate key');
    seen.add(k);
    const at = 2 + i * ENTRY_BYTES;
    out.set(e.key, at);
    out[at + KEY_BYTES] = e.priority;
    view.setUint32(at + KEY_BYTES + 1, e.expires);
  });
  return out;
}

export function decodeInventory(frame: Uint8Array): InventoryEntry[] {
  if (frame.length < 2 || frame[0] !== PROTOCOL_VERSION) fail('bad version');
  const count = frame[1]!;
  if (count > MAX_INVENTORY) fail('too many entries');
  if (frame.length !== 2 + ENTRY_BYTES * count) fail('bad length');
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const seen = new Set<string>();
  const entries: InventoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * ENTRY_BYTES;
    const key = frame.slice(at, at + KEY_BYTES);
    const priority = frame[at + KEY_BYTES]!;
    if (priority > MAX_PRIORITY) fail('bad priority');
    const k = hex(key);
    if (seen.has(k)) fail('duplicate key');
    seen.add(k);
    entries.push({ key, priority, expires: view.getUint32(at + KEY_BYTES + 1) });
  }
  return entries;
}

export function encodeSelect(key: Uint8Array, index: number): Uint8Array {
  if (key.length !== KEY_BYTES) fail('bad key length');
  if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) fail('bad index');
  const out = new Uint8Array(2 + KEY_BYTES);
  out[0] = PROTOCOL_VERSION;
  out.set(key, 1);
  out[1 + KEY_BYTES] = index;
  return out;
}

export function decodeSelect(frame: Uint8Array): { key: Uint8Array; index: number } {
  if (frame.length !== 2 + KEY_BYTES || frame[0] !== PROTOCOL_VERSION) fail('bad select');
  const index = frame[1 + KEY_BYTES]!;
  if (index >= MAX_CHUNKS) fail('bad index');
  return { key: frame.slice(1, 1 + KEY_BYTES), index };
}

export interface Chunk {
  index: number;
  /** 0 = not available. */
  total: number;
  payload: Uint8Array;
}

export const NOT_AVAILABLE = Uint8Array.of(PROTOCOL_VERSION, 0, 0);

export function chunkCount(envelopeLength: number): number {
  return Math.ceil(envelopeLength / CHUNK_PAYLOAD);
}

/** CHUNK frame `index` of `envelope`, or NOT_AVAILABLE if the index is out of range. */
export function encodeChunk(envelope: Uint8Array, index: number): Uint8Array {
  if (envelope.length === 0 || envelope.length > MAX_ENVELOPE_BYTES) fail('bad envelope length');
  const total = chunkCount(envelope.length);
  if (!Number.isInteger(index) || index < 0 || index >= total) return NOT_AVAILABLE;
  const payload = envelope.subarray(index * CHUNK_PAYLOAD, Math.min(envelope.length, (index + 1) * CHUNK_PAYLOAD));
  const out = new Uint8Array(3 + payload.length);
  out[0] = PROTOCOL_VERSION;
  out[1] = index;
  out[2] = total;
  out.set(payload, 3);
  return out;
}

export function decodeChunk(frame: Uint8Array): Chunk {
  if (frame.length < 3 || frame[0] !== PROTOCOL_VERSION) fail('bad chunk');
  const index = frame[1]!;
  const total = frame[2]!;
  const payload = frame.slice(3);
  if (total === 0) {
    if (index !== 0 || payload.length !== 0) fail('bad not-available frame');
    return { index, total, payload };
  }
  if (total > MAX_CHUNKS || index >= total) fail('bad index');
  const last = index === total - 1;
  if (last ? payload.length < 1 || payload.length > CHUNK_PAYLOAD : payload.length !== CHUNK_PAYLOAD) fail('bad payload length');
  return { index, total, payload };
}

/** Concatenate chunks 0..total-1 received in order. */
export function reassemble(chunks: readonly Chunk[]): Uint8Array {
  if (chunks.length === 0) fail('no chunks');
  const total = chunks[0]!.total;
  if (total === 0 || chunks.length !== total) fail('incomplete');
  const parts = chunks.map((c, i) => {
    if (c.index !== i || c.total !== total) fail('chunk out of order');
    return c.payload;
  });
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Envelope shape check (SPEC §2.4). Deliberately minimal and independent of
// alert-format: it only filters junk before full verification.
// ---------------------------------------------------------------------------

function readHead(b: Uint8Array, at: number, major: number): { value: number; next: number } {
  const first = b[at];
  if (first === undefined || first >> 5 !== major) fail('unexpected item');
  const info = first! & 0x1f;
  if (info < 24) return { value: info, next: at + 1 };
  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 0;
  if (width === 0 || at + 1 + width > b.length) fail('unsupported length');
  let value = 0;
  for (let i = 0; i < width; i++) value = value * 256 + b[at + 1 + i]!;
  const min = width === 1 ? 24 : width === 2 ? 0x100 : 0x10000;
  if (value < min) fail('non-shortest length');
  return { value, next: at + 1 + width };
}

/** Returns the signed body if `envelope` has the alert-envelope shape and matches `key`. */
export function checkEnvelope(envelope: Uint8Array, key: Uint8Array): Uint8Array {
  if (envelope.length > MAX_ENVELOPE_BYTES) fail('too large');
  if (envelope[0] !== 0x84) fail('not a 4-item array');
  let at = readHead(envelope, 1, 0).next; // version
  const body = readHead(envelope, at, 2);
  if (body.next + body.value > envelope.length) fail('truncated body');
  const bodyBytes = envelope.slice(body.next, body.next + body.value);
  at = body.next + body.value;
  const sig = readHead(envelope, at, 2);
  if (sig.value !== 64 || sig.next + 64 > envelope.length) fail('bad signature length');
  at = readHead(envelope, sig.next + 64, 0).next; // hops
  if (at !== envelope.length) fail('trailing bytes');
  if (hex(meshKey(bodyBytes)) !== hex(key)) fail('key mismatch');
  return bodyBytes;
}

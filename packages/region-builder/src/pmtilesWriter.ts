/**
 * Minimal PMTiles v3 writer for small extracts (a city or region).
 *
 * All entries go into the root directory (no leaf directories), which keeps
 * the writer short; it refuses archives whose root directory would not fit
 * in the 16 KiB the spec allows for header + root. Identical tile contents
 * are stored once.
 * Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { zxyToTileId } from 'pmtiles';

export interface TileInput {
  z: number;
  x: number;
  y: number;
  data: Uint8Array;
}

export interface WriterOptions {
  /** PMTiles Compression enum of the tile bytes as given (2 = gzip). */
  tileCompression: number;
  /** PMTiles TileType enum (1 = MVT). */
  tileType: number;
  minZoom: number;
  maxZoom: number;
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  center: { lon: number; lat: number; zoom: number };
  metadata: Record<string, unknown>;
}

const HEADER = 127;
const MAX_ROOT = 16384 - HEADER;

function writeVarint(out: number[], n: number): void {
  // n is below 2^53; use arithmetic instead of bit operations past 32 bits
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

function serializeDirectory(entries: Entry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (prev && e.offset === prev.offset + prev.length) writeVarint(out, 0);
    else writeVarint(out, e.offset + 1);
  });
  return gzipSync(Uint8Array.from(out));
}

export function writePmtiles(tiles: readonly TileInput[], opts: WriterOptions): Uint8Array {
  const sorted = tiles
    .map((t) => ({ ...t, tileId: zxyToTileId(t.z, t.x, t.y) }))
    .sort((a, b) => a.tileId - b.tileId);

  // Deduplicate identical contents (common for empty ocean/forest tiles).
  const chunks: Uint8Array[] = [];
  const byHash = new Map<string, { offset: number; length: number }>();
  const entries: Entry[] = [];
  let offset = 0;
  for (const t of sorted) {
    const hash = createHash('sha256').update(t.data).digest('hex');
    let loc = byHash.get(hash);
    if (!loc) {
      loc = { offset, length: t.data.length };
      byHash.set(hash, loc);
      chunks.push(t.data);
      offset += t.data.length;
    }
    const prev = entries[entries.length - 1];
    if (prev && prev.tileId + prev.runLength === t.tileId && prev.offset === loc.offset) {
      prev.runLength++;
    } else {
      entries.push({ tileId: t.tileId, offset: loc.offset, length: loc.length, runLength: 1 });
    }
  }

  const root = serializeDirectory(entries);
  if (root.length > MAX_ROOT) {
    throw new Error(`root directory ${root.length} B exceeds ${MAX_ROOT} B; region too large for this writer`);
  }
  const metadata = gzipSync(Buffer.from(JSON.stringify(opts.metadata), 'utf8'));
  const tileDataLength = offset;

  const rootOffset = HEADER;
  const metadataOffset = rootOffset + root.length;
  const leafOffset = metadataOffset + metadata.length;
  const tileDataOffset = leafOffset;

  const buf = Buffer.alloc(tileDataOffset + tileDataLength);
  buf.write('PMTiles', 0, 'ascii');
  buf.writeUInt8(3, 7);
  const u64 = (pos: number, v: number) => buf.writeBigUInt64LE(BigInt(v), pos);
  u64(8, rootOffset);
  u64(16, root.length);
  u64(24, metadataOffset);
  u64(32, metadata.length);
  u64(40, leafOffset);
  u64(48, 0);
  u64(56, tileDataOffset);
  u64(64, tileDataLength);
  u64(72, sorted.length);
  u64(80, entries.length);
  u64(88, chunks.length);
  buf.writeUInt8(1, 96); // clustered: tile data is in tile-id order
  buf.writeUInt8(2, 97); // internal compression: gzip
  buf.writeUInt8(opts.tileCompression, 98);
  buf.writeUInt8(opts.tileType, 99);
  buf.writeUInt8(opts.minZoom, 100);
  buf.writeUInt8(opts.maxZoom, 101);
  const e7 = (v: number) => Math.round(v * 1e7);
  buf.writeInt32LE(e7(opts.bounds.minLon), 102);
  buf.writeInt32LE(e7(opts.bounds.minLat), 106);
  buf.writeInt32LE(e7(opts.bounds.maxLon), 110);
  buf.writeInt32LE(e7(opts.bounds.maxLat), 114);
  buf.writeUInt8(opts.center.zoom, 118);
  buf.writeInt32LE(e7(opts.center.lon), 119);
  buf.writeInt32LE(e7(opts.center.lat), 123);

  Buffer.from(root).copy(buf, rootOffset);
  Buffer.from(metadata).copy(buf, metadataOffset);
  let pos = tileDataOffset;
  for (const c of chunks) {
    Buffer.from(c).copy(buf, pos);
    pos += c.length;
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
}

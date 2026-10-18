/**
 * Extract the tiles covering a bounding box from a remote PMTiles archive
 * (e.g. the Protomaps daily OpenStreetMap build) using HTTP range requests,
 * so only the needed bytes are downloaded.
 *
 * The pmtiles reader returns tiles DECOMPRESSED, so they are gzipped again
 * here and the result is always reported as gzip-compressed.
 */

import { gzipSync } from 'node:zlib';
import { Compression, PMTiles, type Header } from 'pmtiles';
import type { RegionBbox } from './schema.js';
import type { TileInput } from './pmtilesWriter.js';

export function lonToX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Every z/x/y covering the box for zooms minZoom..maxZoom. */
export function tilesForBbox(bbox: RegionBbox, minZoom: number, maxZoom: number): { z: number; x: number; y: number }[] {
  const out: { z: number; x: number; y: number }[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lonToX(bbox.minLon, z);
    const x1 = lonToX(bbox.maxLon, z);
    const y0 = latToY(bbox.maxLat, z);
    const y1 = latToY(bbox.minLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  }
  return out;
}

export async function extractTiles(
  url: string,
  bbox: RegionBbox,
  maxZoom: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ header: Header; metadata: Record<string, unknown>; tiles: TileInput[]; tileCompression: Compression }> {
  const archive = new PMTiles(url);
  const header = await archive.getHeader();
  const metadata = (await archive.getMetadata()) as Record<string, unknown>;
  const wanted = tilesForBbox(bbox, header.minZoom, Math.min(maxZoom, header.maxZoom));
  const tiles: TileInput[] = [];
  let done = 0;
  const concurrency = 8;
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const t = wanted[next++]!;
      const res = await archive.getZxy(t.z, t.x, t.y);
      if (res?.data) tiles.push({ ...t, data: new Uint8Array(gzipSync(new Uint8Array(res.data), { level: 9 })) });
      onProgress?.(++done, wanted.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { header, metadata, tiles, tileCompression: Compression.Gzip };
}

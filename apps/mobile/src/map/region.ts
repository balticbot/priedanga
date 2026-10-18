/**
 * Offline regions on the phone: download, verify, list, delete.
 *
 * A region is usable only after verification: its manifest must be signed by
 * a Content-role key from the verified content pack, and every file must
 * match its length and SHA-256. Downloads go to a temporary folder and are
 * moved into place only after they verify, so a broken or tampered download
 * never replaces a working region.
 */

import { verifyManifestAsync, type TrustStore } from '@priedanga/alert-format';
import type { RegionIndex, RegionManifest, WalkGraphFile } from '@priedanga/region-builder/schema';
import { loadWalkGraph, type LatLon, type WalkGraph } from '@priedanga/region-builder/route';
import { Asset } from 'expo-asset';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { verifyEd25519 } from '../../modules/priedanga-crypto/src';
import { GLYPH_ASSETS } from './glyphAssets';
import { REGION_ASSETS } from './regionAssets.generated';
import { REGION_FILES, type RegionFile } from './regionTypes';

/** Dev default: `npm run region -- serve` on the same machine (reachable from the iOS simulator). */
export const REGIONS_URL = (process.env.EXPO_PUBLIC_REGIONS_URL ?? 'http://localhost:8788').replace(/\/$/, '');

export interface InstalledRegion {
  manifest: RegionManifest;
  /** file:// URI of the PMTiles archive. */
  tilesUri: string;
  walkUri: string;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const out = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>));
  let s = '';
  for (const b of out) s += HEX[b];
  return s;
}

const regionsRoot = () => new Directory(Paths.document, 'regions');
const regionDir = (id: string) => new Directory(regionsRoot(), id);

export function bboxContains(b: RegionManifest['bbox'], p: LatLon): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;
}

/**
 * Verify a region folder. Throws with a short reason if anything is off.
 * `hashes: false` checks only the signed manifest (cheap, for listing); the
 * region actually shown on the map is always fully hashed first.
 */
export async function verifyRegionDir(dir: Directory, id: string, store: TrustStore, { hashes = true } = {}): Promise<InstalledRegion> {
  const file = (name: RegionFile) => new File(dir, name);
  for (const name of REGION_FILES) if (!file(name).exists) throw new Error(`missing ${name}`);
  const manifestBytes = new Uint8Array(await file('manifest.json').arrayBuffer());
  const sig = new Uint8Array(await file('manifest.sig').arrayBuffer());
  const check = await verifyManifestAsync(manifestBytes, sig, store, Math.floor(Date.now() / 1000), verifyEd25519);
  if (!check.ok) throw new Error(`signature: ${check.reason}`);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as RegionManifest;
  if (manifest.format !== 'priedanga-region-pack' || manifest.id !== id) throw new Error('unexpected manifest');
  for (const entry of manifest.files) {
    if (!hashes) {
      if (file(entry.path as RegionFile).size !== entry.bytes) throw new Error(`file mismatch: ${entry.path}`);
      continue;
    }
    const bytes = new Uint8Array(await file(entry.path as RegionFile).arrayBuffer());
    if (bytes.length !== entry.bytes || (await sha256Hex(bytes)) !== entry.sha256) throw new Error(`file mismatch: ${entry.path}`);
  }
  return { manifest, tilesUri: file('tiles.pmtiles').uri, walkUri: file('walk.json').uri };
}

/** Regions present on the phone whose signed manifest verifies. Broken ones are skipped (and reported). */
export async function listInstalled(store: TrustStore): Promise<{ regions: InstalledRegion[]; broken: string[] }> {
  await installBundled(store);
  const root = regionsRoot();
  if (!root.exists) return { regions: [], broken: [] };
  const regions: InstalledRegion[] = [];
  const broken: string[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory) || entry.name.startsWith('.')) continue;
    try {
      regions.push(await verifyRegionDir(entry, entry.name, store, { hashes: false }));
    } catch {
      broken.push(entry.name);
    }
  }
  return { regions, broken };
}

/** Development builds may bundle regions (PRIEDANGA_BUNDLE_REGIONS=1); install them once. */
async function installBundled(store: TrustStore): Promise<void> {
  for (const [id, assets] of Object.entries(REGION_ASSETS)) {
    if (new File(regionDir(id), 'manifest.json').exists) continue;
    const tmp = new Directory(regionsRoot(), `.bundled-${id}`);
    if (tmp.exists) tmp.delete();
    tmp.create({ intermediates: true });
    for (const name of REGION_FILES) {
      const asset = Asset.fromModule(assets[name]);
      await asset.downloadAsync();
      new File(asset.localUri!).copy(new File(tmp, name));
    }
    await verifyRegionDir(tmp, id, store);
    const dest = regionDir(id);
    if (dest.exists) dest.delete();
    tmp.move(dest);
  }
}

export async function fetchRegionIndex(): Promise<RegionIndex> {
  const res = await fetch(`${REGIONS_URL}/index.json`, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const index = (await res.json()) as RegionIndex;
  if (index.format !== 'priedanga-region-index' || index.version !== 1) throw new Error('unsupported index');
  return index;
}

/**
 * Download a region with overall progress (0..1), verify it, then swap it
 * into place. The previous copy stays until the new one has verified.
 */
export async function downloadRegion(id: string, store: TrustStore, onProgress: (fraction: number) => void): Promise<InstalledRegion> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('bad region id');
  const tmp = new Directory(regionsRoot(), `.download-${id}`);
  if (tmp.exists) tmp.delete();
  tmp.create({ intermediates: true });
  try {
    // Small files first so the total size is known from the manifest.
    for (const name of ['manifest.json', 'manifest.sig'] as const) {
      await new DownloadTask(`${REGIONS_URL}/${id}/${name}`, new File(tmp, name)).downloadAsync();
    }
    const manifest = JSON.parse(await new File(tmp, 'manifest.json').text()) as RegionManifest;
    const total = manifest.files.reduce((n, f) => n + f.bytes, 0) || 1;
    let done = 0;
    for (const entry of manifest.files) {
      if (!REGION_FILES.includes(entry.path as RegionFile)) throw new Error(`unexpected file ${entry.path}`);
      const before = done;
      await new DownloadTask(`${REGIONS_URL}/${id}/${entry.path}`, new File(tmp, entry.path), {
        onProgress: ({ bytesWritten }) => onProgress(Math.min(1, (before + bytesWritten) / total)),
      }).downloadAsync();
      done += entry.bytes;
      onProgress(done / total);
    }
    const verified = await verifyRegionDir(tmp, id, store);
    const dest = regionDir(id);
    if (dest.exists) dest.delete();
    tmp.move(dest);
    return { ...verified, tilesUri: new File(dest, 'tiles.pmtiles').uri, walkUri: new File(dest, 'walk.json').uri };
  } catch (e) {
    if (tmp.exists) tmp.delete();
    throw e;
  }
}

/** Full check (signature + every file hash) of one installed region before use. */
export function verifyInstalled(id: string, store: TrustStore): Promise<InstalledRegion> {
  return verifyRegionDir(regionDir(id), id, store);
}

export function deleteRegion(id: string): void {
  const dir = regionDir(id);
  if (dir.exists) dir.delete();
}

/** The installed region to show for a point: one that contains it, else the first. */
export function pickRegion(regions: readonly InstalledRegion[], point: LatLon | null): InstalledRegion | null {
  if (point) {
    const hit = regions.find((r) => bboxContains(r.manifest.bbox, point));
    if (hit) return hit;
  }
  return regions[0] ?? null;
}

export async function loadRegionGraph(region: InstalledRegion): Promise<WalkGraph> {
  const text = await new File(region.walkUri).text();
  return loadWalkGraph(JSON.parse(text) as WalkGraphFile);
}

/** Copy label glyphs into a folder MapLibre can read as {fontstack}/{range}.pbf. */
export async function installGlyphs(): Promise<string> {
  const root = new Directory(Paths.document, 'glyphs');
  for (const [stack, ranges] of Object.entries(GLYPH_ASSETS)) {
    const dir = new Directory(root, stack);
    dir.create({ intermediates: true, idempotent: true });
    for (const [range, module] of Object.entries(ranges)) {
      const dest = new File(dir, `${range}.pbf`);
      if (dest.exists) continue;
      const asset = Asset.fromModule(module);
      await asset.downloadAsync();
      new File(asset.localUri!).copy(dest);
    }
  }
  return root.uri.replace(/\/$/, '');
}

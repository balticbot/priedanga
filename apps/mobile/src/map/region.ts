/**
 * Installing and verifying an offline region on the phone.
 *
 * The bundled (or, later, downloaded) region files are copied into the app's
 * document folder, then checked like the content pack: the manifest must be
 * signed by a Content-role key from the verified pack, and every file must
 * match its SHA-256. Only then are the tiles shown or the network used.
 */

import { verifyManifestAsync, type TrustStore } from '@priedanga/alert-format';
import type { RegionManifest, WalkGraphFile } from '@priedanga/region-builder/schema';
import { loadWalkGraph, type WalkGraph } from '@priedanga/region-builder/route';
import { Asset } from 'expo-asset';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { verifyEd25519 } from '../../modules/priedanga-crypto/src';
import { GLYPH_ASSETS } from './glyphAssets';
import { REGION_ASSETS } from './regionAssets.generated';
import type { RegionFile } from './regionTypes';

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

async function copyAsset(module: number, dest: File): Promise<void> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error(`asset unavailable: ${asset.name}`);
  if (dest.exists) dest.delete();
  new File(asset.localUri).copy(dest);
}

export function availableRegions(): string[] {
  return Object.keys(REGION_ASSETS);
}

/** Copy the region into the document folder (once) and verify it. */
export async function installRegion(id: string, store: TrustStore): Promise<InstalledRegion> {
  const assets = REGION_ASSETS[id];
  if (!assets) throw new Error(`region ${id} is not available in this build`);
  const dir = new Directory(Paths.document, 'regions', id);
  dir.create({ intermediates: true, idempotent: true });
  const file = (name: RegionFile) => new File(dir, name);

  const bundledManifest = Asset.fromModule(assets['manifest.json']);
  await bundledManifest.downloadAsync();
  const fresh = new Uint8Array(await new File(bundledManifest.localUri!).arrayBuffer());
  const current = file('manifest.json');
  const same = current.exists && (await sha256Hex(new Uint8Array(await current.arrayBuffer()))) === (await sha256Hex(fresh));
  if (!same) {
    for (const name of Object.keys(assets) as RegionFile[]) await copyAsset(assets[name], file(name));
  }

  const manifestBytes = new Uint8Array(await file('manifest.json').arrayBuffer());
  const sig = new Uint8Array(await file('manifest.sig').arrayBuffer());
  const check = await verifyManifestAsync(manifestBytes, sig, store, Math.floor(Date.now() / 1000), verifyEd25519);
  if (!check.ok) throw new Error(`region signature: ${check.reason}`);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as RegionManifest;
  if (manifest.format !== 'priedanga-region-pack' || manifest.id !== id) throw new Error('unexpected region manifest');
  for (const entry of manifest.files) {
    const bytes = new Uint8Array(await file(entry.path as RegionFile).arrayBuffer());
    if (bytes.length !== entry.bytes || (await sha256Hex(bytes)) !== entry.sha256) throw new Error(`region file mismatch: ${entry.path}`);
  }
  return { manifest, tilesUri: file('tiles.pmtiles').uri, walkUri: file('walk.json').uri };
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
      if (!dest.exists) await copyAsset(module, dest);
    }
  }
  return root.uri.replace(/\/$/, '');
}

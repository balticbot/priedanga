import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256Hex, signManifest } from '@priedanga/alert-format';
import { downloadModel, type Download } from './fetch.js';
import type { DevKeys } from './keys.js';
import { buildMunicipalityIndex, normalizeAll, parseMunicipalities, Stats } from './normalize.js';
import {
  PACK_FORMAT,
  PACK_FORMAT_VERSION,
  TRUST_FILE,
  type Manifest,
  type ManifestFile,
  type MunicipalitiesFile,
  type PackPlace,
  type PackSource,
  type PlaceKind,
  type PlacesFile,
  type TrustFile,
} from './schema.js';

const PAGD_ATTRIBUTION = 'Priešgaisrinės apsaugos ir gelbėjimo departamentas prie VRM, per Valstybės duomenų agentūrą (data.gov.lt)';
const RC_ATTRIBUTION = 'Registrų centras, Adresų registras (data.gov.lt)';

export const MODELS: Record<PlaceKind, string> = {
  shelter: 'datasets/gov/pagd/priedangos/Priedanga',
  kas: 'datasets/gov/pagd/kas/KAS',
  evacuation: 'datasets/gov/pagd/evakuacijos_punktai/EvakuacijosPunktas',
  siren: 'datasets/gov/pagd/sirenos/Sirena',
};
export const MUNICIPALITY_MODEL = 'datasets/gov/rc/ar/savivaldybe/Savivaldybe';

export interface BuildOptions {
  outDir: string;
  cacheDir: string;
  keys: DevKeys;
  offline?: boolean;
  now?: Date;
}

export interface BuildResult {
  manifest: Manifest;
  outDir: string;
}

const encoder = new TextEncoder();

export async function buildPack(opts: BuildOptions): Promise<BuildResult> {
  const now = opts.now ?? new Date();
  const dl = (model: string) => downloadModel(model, { cacheDir: opts.cacheDir, ...(opts.offline ? { offline: true } : {}) });

  const munDownload = await dl(MUNICIPALITY_MODEL);
  const municipalities = parseMunicipalities(munDownload.rows);
  const munIndex = buildMunicipalityIndex(municipalities);

  const stats = new Stats();
  const places: PackPlace[] = [];
  const sources: PackSource[] = [source('rc/ar/savivaldybe', munDownload, RC_ATTRIBUTION)];
  for (const kind of Object.keys(MODELS) as PlaceKind[]) {
    const download = await dl(MODELS[kind]);
    stats.add(`${kind}.source_rows`, download.rows.length);
    places.push(...normalizeAll(kind, download.rows, munIndex, stats));
    sources.push(source(MODELS[kind].replace('datasets/gov/', '').replace(/\/[A-Z][A-Za-z]+$/, ''), download, PAGD_ATTRIBUTION));
  }
  places.sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  mkdirSync(opts.outDir, { recursive: true });
  const files: ManifestFile[] = [];
  const write = (path: string, data: unknown) => {
    const bytes = encoder.encode(JSON.stringify(data));
    writeFileSync(join(opts.outDir, path), bytes);
    files.push({ path, bytes: bytes.length, sha256: sha256Hex(bytes) });
  };

  const placesFile: PlacesFile = { format: PACK_FORMAT, version: PACK_FORMAT_VERSION, places };
  const municipalitiesFile: MunicipalitiesFile = { format: PACK_FORMAT, version: PACK_FORMAT_VERSION, municipalities };
  write('places.json', placesFile);
  write('municipalities.json', municipalitiesFile);

  const manifest: Manifest = {
    format: PACK_FORMAT,
    version: PACK_FORMAT_VERSION,
    packVersion: packVersion(now),
    created: now.toISOString(),
    files,
    sources,
    stats: stats.counts,
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(opts.outDir, 'manifest.json'), manifestBytes);
  writeFileSync(join(opts.outDir, 'manifest.sig'), signManifest(opts.keys.contentSecretKey, manifestBytes));

  const trust: TrustFile = { certificates: [bytesToHex(opts.keys.contentCertificate)] };
  writeFileSync(join(opts.outDir, TRUST_FILE), JSON.stringify(trust, null, 2) + '\n');

  return { manifest, outDir: opts.outDir };
}

function source(id: string, d: Download, attribution: string): PackSource {
  return {
    id,
    url: d.url,
    license: 'CC BY 4.0',
    attribution,
    rows: d.rows.length,
    fetched: d.fetched,
  };
}

/** UTC yyyymmddHHMM as an integer. */
export function packVersion(d: Date): number {
  const p = (n: number) => String(n).padStart(2, '0');
  return Number(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`);
}

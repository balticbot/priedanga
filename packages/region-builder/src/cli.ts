/**
 * Build offline region packs.
 *
 *   npm run region -w @priedanga/region-builder -- build kaunas
 *   npm run region -w @priedanga/region-builder -- fonts
 *
 * build  extract map tiles (Protomaps OpenStreetMap build, via range requests)
 *        and the walking network (Overpass) for a region, then sign a manifest
 *        with the dev content key -> packs/regions/<id>/
 * fonts  download the few label glyph ranges the map style needs
 *        -> apps/mobile/assets/glyphs/
 * index  write packs/regions/index.json from the built regions
 * serve  serve packs/regions over HTTP for development (default port 8788)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexToBytes } from '@noble/hashes/utils.js';
import { sha256Hex, signManifest } from '@priedanga/alert-format';
import { writePmtiles } from './pmtilesWriter.js';
import { REGION_FORMAT, REGION_VERSION, type RegionBbox, type RegionIndex, type RegionManifest } from './schema.js';
import { extractTiles } from './tiles.js';
import { fetchWalkGraph, OVERPASS_URL } from './walk.js';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export const REGIONS: Record<string, { name: string; bbox: RegionBbox }> = {
  kaunas: { name: 'Kaunas', bbox: { minLon: 23.78, minLat: 54.83, maxLon: 24.07, maxLat: 54.97 } },
  vilnius: { name: 'Vilnius', bbox: { minLon: 25.1, minLat: 54.62, maxLon: 25.42, maxLat: 54.79 } },
};

/** Protomaps daily planet build; the newest available is found by probing back from today. */
async function latestProtomapsBuild(): Promise<string> {
  for (let back = 0; back < 10; back++) {
    const d = new Date(Date.now() - back * 86_400_000);
    const stamp = d.toISOString().slice(0, 10).replaceAll('-', '');
    const url = `https://build.protomaps.com/${stamp}.pmtiles`;
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return url;
  }
  throw new Error('no Protomaps build found in the last 10 days');
}

const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
/** Basic Latin + Latin-1, Latin Extended-A (ą č ę ė į š ų ū ž), punctuation („ “ –). */
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];
const FONT_BASE = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts';

async function fonts(): Promise<void> {
  const out = join(repoRoot, 'apps/mobile/assets/glyphs');
  for (const stack of FONT_STACKS) {
    const dir = join(out, stack.replaceAll(' ', '-'));
    mkdirSync(dir, { recursive: true });
    for (const range of GLYPH_RANGES) {
      const res = await fetch(`${FONT_BASE}/${encodeURIComponent(stack)}/${range}.pbf`);
      if (!res.ok) throw new Error(`glyphs ${stack} ${range}: ${res.status}`);
      writeFileSync(join(dir, `${range}.pbf`), new Uint8Array(await res.arrayBuffer()));
    }
  }
  console.log(`glyphs -> ${out}`);
}

async function build(id: string): Promise<void> {
  const region = REGIONS[id];
  if (!region) throw new Error(`unknown region ${id}; known: ${Object.keys(REGIONS).join(', ')}`);
  const keyFile = join(repoRoot, 'secrets/dev/content.sk');
  if (!existsSync(keyFile)) throw new Error('no dev content key; run `npm run pack` first');
  const outDir = join(repoRoot, 'packs/regions', id);
  mkdirSync(outDir, { recursive: true });
  const fetched = new Date().toISOString();

  const source = await latestProtomapsBuild();
  console.log(`tiles from ${source}`);
  let last = 0;
  const { header, metadata, tiles, tileCompression } = await extractTiles(source, region.bbox, 15, (done, total) => {
    if (done - last >= 100 || done === total) {
      last = done;
      console.log(`  tiles ${done}/${total}`);
    }
  });
  const cx = (region.bbox.minLon + region.bbox.maxLon) / 2;
  const cy = (region.bbox.minLat + region.bbox.maxLat) / 2;
  const pmtiles = writePmtiles(tiles, {
    tileCompression,
    tileType: header.tileType,
    minZoom: header.minZoom,
    maxZoom: Math.min(15, header.maxZoom),
    bounds: region.bbox,
    center: { lon: cx, lat: cy, zoom: 12 },
    metadata: { ...metadata, name: `Priedanga ${region.name}`, description: `Extract of ${source}` },
  });

  console.log(`walking network from ${OVERPASS_URL}`);
  const { stats: walkStats, ...walk } = await fetchWalkGraph(region.bbox);
  const walkBytes = Buffer.from(JSON.stringify(walk), 'utf8');

  const files: RegionManifest['files'] = [];
  const write = (path: string, data: Uint8Array) => {
    writeFileSync(join(outDir, path), data);
    files.push({ path, bytes: data.length, sha256: sha256Hex(data) });
  };
  write('tiles.pmtiles', pmtiles);
  write('walk.json', walkBytes);

  const manifest: RegionManifest = {
    format: REGION_FORMAT,
    version: REGION_VERSION,
    id,
    name: region.name,
    bbox: region.bbox,
    created: fetched,
    files,
    sources: [
      { id: 'protomaps-basemap', url: source, license: 'ODbL (OpenStreetMap)', attribution: '© OpenStreetMap contributors, Protomaps', fetched },
      { id: 'osm-overpass', url: OVERPASS_URL, license: 'ODbL', attribution: '© OpenStreetMap contributors', fetched },
    ],
    stats: { tiles: tiles.length, ...Object.fromEntries(Object.entries(walkStats).map(([k, v]) => [`walk.${k}`, v])) },
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(join(outDir, 'manifest.json'), manifestBytes);
  writeFileSync(join(outDir, 'manifest.sig'), signManifest(hexToBytes(readFileSync(keyFile, 'utf8').trim()), manifestBytes));

  console.log(`region ${id} -> ${outDir}`);
  for (const f of files) console.log(`  ${f.path.padEnd(16)} ${(f.bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log('  stats', JSON.stringify(manifest.stats));
}

const regionsDir = join(repoRoot, 'packs/regions');

function index(): RegionIndex {
  const regions: RegionIndex['regions'] = [];
  for (const id of readdirSync(regionsDir).sort()) {
    const manifestFile = join(regionsDir, id, 'manifest.json');
    if (!existsSync(manifestFile)) continue;
    const m = JSON.parse(readFileSync(manifestFile, 'utf8')) as RegionManifest;
    regions.push({ id: m.id, name: m.name, bbox: m.bbox, bytes: m.files.reduce((n, f) => n + f.bytes, 0), created: m.created });
  }
  const out: RegionIndex = { format: 'priedanga-region-index', version: 1, generated: new Date().toISOString(), regions };
  writeFileSync(join(regionsDir, 'index.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`index: ${regions.map((r) => `${r.id} (${(r.bytes / 1e6).toFixed(1)} MB)`).join(', ')}`);
  return out;
}

const SAFE = /^\/(index\.json|[a-z0-9-]+\/(manifest\.json|manifest\.sig|tiles\.pmtiles|walk\.json))$/;

function serve(port: number): void {
  index();
  createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]!;
    if (!SAFE.test(path)) return void res.writeHead(404).end();
    const file = join(regionsDir, path);
    if (!existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, {
      'content-type': path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': 'no-cache',
    });
    res.end(readFileSync(file));
    console.log(`[regions] ${req.method} ${path}`);
  }).listen(port, () => console.log(`[regions] serving ${regionsDir} at http://localhost:${port}/index.json`));
}

const [command, arg] = process.argv.slice(2);
if (command === 'build' && arg) {
  await build(arg);
  index();
} else if (command === 'fonts') await fonts();
else if (command === 'index') index();
else if (command === 'serve') serve(Number(arg ?? 8788));
else {
  console.error('usage: region build <id> | fonts | index | serve [port]');
  process.exit(1);
}

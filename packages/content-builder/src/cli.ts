/**
 * Build a signed content pack from official open data.
 *
 *   npm run pack -w @priedanga/content-builder -- [--out DIR] [--offline]
 *
 * --out      output directory (default: packs/dev)
 * --offline  use the download cache only, no network
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex } from '@noble/hashes/utils.js';
import { loadDevKeys } from './keys.js';
import { buildPack } from './pack.js';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const outDir = resolve(arg('--out') ?? join(repoRoot, 'packs/dev'));
const offline = args.includes('--offline');
const now = new Date();

const keys = loadDevKeys(join(repoRoot, 'secrets/dev'), Math.floor(now.getTime() / 1000));
const { manifest } = await buildPack({
  outDir,
  cacheDir: join(repoRoot, 'packages/content-builder/.cache'),
  keys,
  offline,
  now,
});

const rootHex = bytesToHex(keys.rootPublicKey);
writeFileSync(join(outDir, 'DEV_ROOT_PUBLIC_KEY.txt'), rootHex + '\n');

console.log(`pack ${manifest.packVersion} -> ${outDir}`);
for (const f of manifest.files) console.log(`  ${f.path.padEnd(22)} ${(f.bytes / 1024).toFixed(0).padStart(6)} KB`);
console.log('stats:');
for (const [k, v] of Object.entries(manifest.stats).sort()) console.log(`  ${k.padEnd(40)} ${v}`);
console.log(`dev root public key: ${rootHex}`);

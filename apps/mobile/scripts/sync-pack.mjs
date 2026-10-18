/**
 * Copy the canonical content pack (packs/dev) into the app as byte-exact
 * `.bin` assets. Metro would otherwise parse `.json` files into objects, and
 * the app must hash the exact bytes the manifest was signed over.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../../packs/dev');
const dst = join(here, '../assets/pack');
const FILES = ['manifest.json', 'manifest.sig', 'trust.json', 'places.json', 'municipalities.json', 'guidance.json', 'checklists.json'];

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
const present = new Set(readdirSync(src));
for (const f of FILES) {
  if (!present.has(f)) throw new Error(`pack file missing: ${f} (run npm run pack)`);
  copyFileSync(join(src, f), join(dst, `${f}.bin`));
}
console.log(`synced ${FILES.length} pack files -> assets/pack/*.bin`);

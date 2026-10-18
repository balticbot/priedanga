import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACK_PATHS, verifyPack, type PackPath } from '../src/pack/verifyPack';
import { ROOT_PUBLIC_KEY_HEX } from '../src/trust/root';

const packDir = join(__dirname, '../../../packs/dev');
const load = (): Record<PackPath, Uint8Array> =>
  Object.fromEntries(PACK_PATHS.map((p) => [p, new Uint8Array(readFileSync(join(packDir, p)))])) as Record<PackPath, Uint8Array>;
const now = Math.floor(Date.now() / 1000);

describe('bundled dev pack', () => {
  it('pins the same root the pack was built with', () => {
    expect(readFileSync(join(packDir, 'DEV_ROOT_PUBLIC_KEY.txt'), 'utf8').trim()).toBe(ROOT_PUBLIC_KEY_HEX);
  });

  it('verifies and parses', () => {
    const r = verifyPack(load(), ROOT_PUBLIC_KEY_HEX, now);
    expect(r.ok, r.ok ? '' : `${r.reason} ${r.detail}`).toBe(true);
    if (!r.ok) return;
    expect(r.places.length).toBeGreaterThan(10_000);
    expect(r.municipalities).toHaveLength(60);
  });

  it('rejects a modified places file', () => {
    const files = load();
    const tampered = files['places.json'].slice();
    tampered[100] = tampered[100] === 0x31 ? 0x32 : 0x31;
    expect(verifyPack({ ...files, 'places.json': tampered }, ROOT_PUBLIC_KEY_HEX, now)).toMatchObject({
      ok: false,
      reason: 'FILE_MISMATCH',
      detail: 'places.json',
    });
  });

  it('rejects a modified manifest', () => {
    const files = load();
    const m = files['manifest.json'].slice();
    m[m.length - 2] = 0x20;
    expect(verifyPack({ ...files, 'manifest.json': m }, ROOT_PUBLIC_KEY_HEX, now)).toMatchObject({
      ok: false,
      reason: 'MANIFEST_SIGNATURE',
    });
  });

  it('rejects a pack when a different root is pinned', () => {
    expect(verifyPack(load(), '00'.repeat(32), now)).toMatchObject({ ok: false, reason: 'MANIFEST_SIGNATURE', detail: 'UNKNOWN_KEY' });
  });

  it('reports missing files', () => {
    const { 'manifest.sig': _, ...rest } = load();
    expect(verifyPack(rest, ROOT_PUBLIC_KEY_HEX, now)).toMatchObject({ ok: false, reason: 'MISSING_FILE', detail: 'manifest.sig' });
  });
});

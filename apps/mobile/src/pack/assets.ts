import type { PackPath } from './verifyPack';

/** Bundled pack files (copied by scripts/sync-pack.mjs). */
export const PACK_ASSETS: Record<PackPath, number> = {
  'manifest.json': require('../../assets/pack/manifest.json.bin'),
  'manifest.sig': require('../../assets/pack/manifest.sig.bin'),
  'trust.json': require('../../assets/pack/trust.json.bin'),
  'places.json': require('../../assets/pack/places.json.bin'),
  'municipalities.json': require('../../assets/pack/municipalities.json.bin'),
  'guidance.json': require('../../assets/pack/guidance.json.bin'),
  'checklists.json': require('../../assets/pack/checklists.json.bin'),
};

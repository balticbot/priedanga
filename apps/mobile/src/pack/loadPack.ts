import { ROOT_PUBLIC_KEY_HEX } from '../trust/root';
import { PACK_ASSETS } from './assets';
import { readAssetBytes } from './readAsset';
import { PACK_PATHS, verifyPack, type PackPath, type VerifyPackResult } from './verifyPack';

export async function loadBundledPack(): Promise<VerifyPackResult> {
  const files: Partial<Record<PackPath, Uint8Array>> = {};
  await Promise.all(
    PACK_PATHS.map(async (p) => {
      files[p] = await readAssetBytes(PACK_ASSETS[p]);
    }),
  );
  return verifyPack(files, ROOT_PUBLIC_KEY_HEX, Math.floor(Date.now() / 1000));
}

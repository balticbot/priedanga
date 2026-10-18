import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { verifyEd25519 } from '../../modules/priedanga-crypto/src';
import { ROOT_PUBLIC_KEY_HEX } from '../trust/root';
import { PACK_ASSETS } from './assets';
import { readAssetBytes } from './readAsset';
import { PACK_PATHS, verifyPack, type PackPath, type PackStage, type VerifyPackResult } from './verifyPack';

export type PackTimings = Partial<Record<PackStage | 'read' | 'total', number>>;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** Native SHA-256 (CommonCrypto / java.security / WebCrypto). */
async function nativeSha256Hex(data: Uint8Array): Promise<string> {
  const out = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, data as Uint8Array<ArrayBuffer>));
  let hex = '';
  for (const b of out) hex += HEX[b];
  return hex;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function loadBundledPack(): Promise<{ result: VerifyPackResult; timings: PackTimings }> {
  const timings: PackTimings = {};
  const start = now();
  const files: Partial<Record<PackPath, Uint8Array>> = {};
  await Promise.all(
    PACK_PATHS.map(async (p) => {
      files[p] = await readAssetBytes(PACK_ASSETS[p]);
    }),
  );
  timings.read = now() - start;
  const result = await verifyPack(
    files,
    ROOT_PUBLIC_KEY_HEX,
    Math.floor(Date.now() / 1000),
    (stage, ms) => {
      timings[stage] = ms;
    },
    nativeSha256Hex,
    verifyEd25519,
  );
  timings.total = now() - start;
  console.log('[priedanga] pack load ms', JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)]))));
  return { result, timings };
}

/**
 * Verify a content pack before any of it is used:
 *   1. certificates in trust.json are checked against the pinned root
 *   2. manifest.json signature must come from a valid Content-role key
 *   3. every file listed in the manifest must match its length and SHA-256
 * No I/O, so it runs identically in the app and in tests. SHA-256 and Ed25519
 * are injectable so the app can use native implementations.
 */

import {
  buildTrustStoreAsync,
  decodeUtf8,
  sha256Hex,
  verifyEd25519,
  verifyManifestAsync,
  type Ed25519Verifier,
  type ManifestFailure,
} from '@priedanga/alert-format';
import type {
  Manifest,
  MunicipalitiesFile,
  PackPlace,
  Municipality,
  PlacesFile,
  TrustFile,
} from '@priedanga/content-builder/schema';
import { hexToBytes } from './hex';

export const PACK_PATHS = ['manifest.json', 'manifest.sig', 'trust.json', 'places.json', 'municipalities.json'] as const;
export type PackPath = (typeof PACK_PATHS)[number];

export type PackFailure =
  | { reason: 'MISSING_FILE'; detail: string }
  | { reason: 'BAD_TRUST_FILE'; detail: string }
  | { reason: 'MANIFEST_SIGNATURE'; detail: ManifestFailure }
  | { reason: 'BAD_MANIFEST'; detail: string }
  | { reason: 'FILE_MISMATCH'; detail: string }
  | { reason: 'BAD_CONTENT'; detail: string };

export interface VerifiedPack {
  manifest: Manifest;
  places: PackPlace[];
  municipalities: Municipality[];
  signerName: string;
}

export type VerifyPackResult = ({ ok: true } & VerifiedPack) | ({ ok: false } & PackFailure);

const decode = (b: Uint8Array): string =>
  typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }).decode(b) : decodeUtf8(b);

export type PackStage = 'trust' | 'signature' | 'hash' | 'parse';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Hex SHA-256. The app injects the platform's native implementation; pure JS is ~10x too slow on Hermes. */
export type Sha256Hex = (data: Uint8Array) => Promise<string> | string;

export async function verifyPack(
  files: Partial<Record<PackPath, Uint8Array>>,
  rootPublicKeyHex: string,
  nowSeconds: number,
  onTiming?: (stage: PackStage, ms: number) => void,
  hash: Sha256Hex = sha256Hex,
  ed25519: Ed25519Verifier = verifyEd25519,
): Promise<VerifyPackResult> {
  let mark = now();
  const lap = (stage: PackStage) => {
    const t = now();
    onTiming?.(stage, t - mark);
    mark = t;
  };
  for (const p of PACK_PATHS) {
    if (files[p] === undefined) return { ok: false, reason: 'MISSING_FILE', detail: p };
  }
  const f = files as Record<PackPath, Uint8Array>;

  let trust: TrustFile;
  try {
    trust = JSON.parse(decode(f['trust.json'])) as TrustFile;
    if (!Array.isArray(trust.certificates)) throw new Error('certificates missing');
  } catch (e) {
    return { ok: false, reason: 'BAD_TRUST_FILE', detail: String(e) };
  }
  const { store } = await buildTrustStoreAsync(
    {
      rootPublicKey: hexToBytes(rootPublicKeyHex),
      certificates: trust.certificates.map(hexToBytes),
      ...(trust.revocation !== undefined ? { revocation: hexToBytes(trust.revocation) } : {}),
    },
    ed25519,
  );

  lap('trust');
  const sig = await verifyManifestAsync(f['manifest.json'], f['manifest.sig'], store, nowSeconds, ed25519);
  if (!sig.ok) return { ok: false, reason: 'MANIFEST_SIGNATURE', detail: sig.reason };
  lap('signature');

  let manifest: Manifest;
  try {
    manifest = JSON.parse(decode(f['manifest.json'])) as Manifest;
    if (manifest.format !== 'priedanga-content-pack' || manifest.version !== 1) throw new Error('unsupported pack format');
  } catch (e) {
    return { ok: false, reason: 'BAD_MANIFEST', detail: String(e) };
  }

  for (const entry of manifest.files) {
    const data = f[entry.path as PackPath];
    if (data === undefined) return { ok: false, reason: 'MISSING_FILE', detail: entry.path };
    if (data.length !== entry.bytes || (await hash(data)) !== entry.sha256) {
      return { ok: false, reason: 'FILE_MISMATCH', detail: entry.path };
    }
  }
  lap('hash');
  for (const required of ['places.json', 'municipalities.json']) {
    if (!manifest.files.some((e) => e.path === required)) {
      return { ok: false, reason: 'BAD_MANIFEST', detail: `${required} not listed` };
    }
  }

  try {
    const places = JSON.parse(decode(f['places.json'])) as PlacesFile;
    const municipalities = JSON.parse(decode(f['municipalities.json'])) as MunicipalitiesFile;
    if (!Array.isArray(places.places) || !Array.isArray(municipalities.municipalities)) throw new Error('bad shape');
    lap('parse');
    return {
      ok: true,
      manifest,
      places: places.places,
      municipalities: municipalities.municipalities,
      signerName: sig.signer.name,
    };
  } catch (e) {
    return { ok: false, reason: 'BAD_CONTENT', detail: String(e) };
  }
}

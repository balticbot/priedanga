/**
 * Content-pack manifests.
 *
 * A manifest is an arbitrary byte string (the pack builder writes JSON) that
 * lists every file in a content pack with its SHA-256 hash. It is signed with
 * a Content-role key. The signature covers the EXACT manifest bytes, so no
 * canonical JSON is needed: verifiers hash and check what they received.
 *
 * Signature file: CBOR [keyId: bstr(8), signature: bstr(64)]
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { asArray, bytes, fail } from './fields.js';
import { decode, encode } from './cbor.js';
import { Context, deriveKeyId, getPublicKey, signWithContext, type Ed25519Verifier } from './crypto.js';
import { runAsync, runSync, type Checks } from './sigcheck.js';
import { KEY_ID_BYTES, Role, SIGNATURE_BYTES, type Certificate } from './model.js';
import type { TrustStore } from './verify.js';

export function signManifest(contentSecretKey: Uint8Array, manifest: Uint8Array): Uint8Array {
  const keyId = deriveKeyId(getPublicKey(contentSecretKey));
  return encode([keyId, signWithContext(Context.manifest, manifest, contentSecretKey)]);
}

export type ManifestFailure =
  | 'MALFORMED'
  | 'UNKNOWN_KEY'
  | 'BAD_SIGNATURE'
  | 'KEY_REVOKED'
  | 'ROLE_NOT_ALLOWED'
  | 'KEY_NOT_VALID';

export type ManifestResult = { ok: true; signer: Certificate } | { ok: false; reason: ManifestFailure };

/**
 * Verify a manifest signature. Only Content-role certificates may sign
 * manifests, and the certificate must be valid at `now`.
 */
export function verifyManifest(
  manifest: Uint8Array,
  signatureFile: Uint8Array,
  store: TrustStore,
  now: number,
): ManifestResult {
  return runSync(verifyManifestSteps(manifest, signatureFile, store, now));
}

/** {@link verifyManifest} with an injected Ed25519 verifier (e.g. native). */
export function verifyManifestAsync(
  manifest: Uint8Array,
  signatureFile: Uint8Array,
  store: TrustStore,
  now: number,
  verify?: Ed25519Verifier,
): Promise<ManifestResult> {
  return runAsync(verifyManifestSteps(manifest, signatureFile, store, now), verify);
}

function* verifyManifestSteps(
  manifest: Uint8Array,
  signatureFile: Uint8Array,
  store: TrustStore,
  now: number,
): Checks<ManifestResult> {
  let keyId: Uint8Array;
  let signature: Uint8Array;
  try {
    const arr = asArray(decode(signatureFile), 'manifest signature');
    if (arr.length !== 2) fail('manifest signature must have 2 elements');
    keyId = bytes(arr[0], 'keyId', KEY_ID_BYTES);
    signature = bytes(arr[1], 'signature', SIGNATURE_BYTES);
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  const signer = store.certificates.get(bytesToHex(keyId));
  if (signer === undefined) return { ok: false, reason: 'UNKNOWN_KEY' };
  const [signatureOk] = yield [{ context: Context.manifest, body: manifest, signature, publicKey: signer.publicKey }];
  if (signatureOk !== true) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (store.revokedKeyIds.has(bytesToHex(signer.keyId))) return { ok: false, reason: 'KEY_REVOKED' };
  if (signer.role !== Role.Content) return { ok: false, reason: 'ROLE_NOT_ALLOWED' };
  if (now < signer.validFrom || now > signer.validTo) return { ok: false, reason: 'KEY_NOT_VALID' };
  return { ok: true, signer };
}

/** Lowercase hex SHA-256, as used for file hashes in manifests. */
export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

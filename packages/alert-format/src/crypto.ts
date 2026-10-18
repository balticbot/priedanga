import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { KEY_ID_BYTES, PUBLIC_KEY_BYTES, SIGNATURE_BYTES } from './model.js';
import { encodeUtf8 } from './utf8.js';

/**
 * Domain-separation contexts. Every signature covers
 *   UTF-8(context) || 0x00 || body
 * so a signature made for one kind of object can never be replayed as another
 * (e.g. a content-manifest signature passed off as an alert).
 */
export const Context = {
  alert: 'priedanga/v1/alert',
  cert: 'priedanga/v1/cert',
  revocation: 'priedanga/v1/revocation',
  keyId: 'priedanga/v1/keyid',
} as const;
export type Context = (typeof Context)[keyof typeof Context];

function contextMessage(context: Context, body: Uint8Array): Uint8Array {
  return concatBytes(encodeUtf8(context), Uint8Array.of(0), body);
}

export function signWithContext(context: Context, body: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(contextMessage(context, body), secretKey);
}

/**
 * Strict RFC 8032 verification (ZIP-215 relaxations disabled), so that the JS
 * implementation accepts the same signatures as strict native libraries.
 * Never throws: malformed inputs simply fail verification.
 */
export function verifyWithContext(
  context: Context,
  body: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (signature.length !== SIGNATURE_BYTES || publicKey.length !== PUBLIC_KEY_BYTES) return false;
  try {
    return ed25519.verify(signature, contextMessage(context, body), publicKey, { zip215: false });
  } catch {
    return false;
  }
}

/** Key ID = first 8 bytes of SHA-256(UTF-8("priedanga/v1/keyid") || 0x00 || publicKey). */
export function deriveKeyId(publicKey: Uint8Array): Uint8Array {
  return sha256(contextMessage(Context.keyId, publicKey)).slice(0, KEY_ID_BYTES);
}

export function getPublicKey(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

/** Generate a random Ed25519 secret key (32 bytes), or derive one from a 32-byte seed. */
export function generateSecretKey(seed?: Uint8Array): Uint8Array {
  return ed25519.utils.randomSecretKey(seed);
}

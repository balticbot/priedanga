import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

interface PriedangaCryptoNative {
  verifyEd25519(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
}

const native = requireNativeModule<PriedangaCryptoNative>('PriedangaCrypto');

/** Which implementation `verifyEd25519` uses on this platform. */
export const ed25519Implementation: 'CryptoKit' | 'BouncyCastle' | 'noble (JS)' =
  Platform.OS === 'ios' ? 'CryptoKit' : 'BouncyCastle';

/** Hand native code a standalone buffer, never a view into a larger one. */
const standalone = (a: Uint8Array): Uint8Array =>
  a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice();

/**
 * Strict RFC 8032 Ed25519 verification in native code (CryptoKit on iOS,
 * BouncyCastle on Android), conforming to
 * packages/alert-format/test-vectors/ed25519-strict.json. Never rejects:
 * any native failure counts as an invalid signature.
 */
export async function verifyEd25519(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  try {
    return native.verifyEd25519(standalone(signature), standalone(message), standalone(publicKey)) === true;
  } catch {
    return false;
  }
}

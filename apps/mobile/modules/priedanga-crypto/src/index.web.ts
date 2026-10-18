import { verifyEd25519 as verifyJs } from '@priedanga/alert-format';

/** Which implementation `verifyEd25519` uses on this platform. */
export const ed25519Implementation: 'CryptoKit' | 'BouncyCastle' | 'noble (JS)' = 'noble (JS)';

/** Web has no native module: the strict JS reference from alert-format. */
export async function verifyEd25519(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  return verifyJs(signature, message, publicKey);
}

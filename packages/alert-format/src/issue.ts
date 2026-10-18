/**
 * Issuing side: creating certificates, revocation lists and signed alerts.
 * Used by the issuer console, the content builder and test-vector generation.
 * Phones only ever need verify.ts.
 */

import { randomBytes } from '@noble/hashes/utils.js';
import { encodeAlertBody, encodeAlertEnvelope } from './alert.js';
import { encodeCertificateBody, encodeRevocationBody, encodeSignedObject } from './cert.js';
import { Context, deriveKeyId, getPublicKey, signWithContext } from './crypto.js';
import { ALERT_ID_BYTES, type Alert, type Certificate, type RevocationList } from './model.js';

export function newAlertId(): Uint8Array {
  return randomBytes(ALERT_ID_BYTES);
}

/** Create a root-signed certificate. The key ID is derived from the public key. */
export function createCertificate(rootSecretKey: Uint8Array, cert: Omit<Certificate, 'keyId'>): Uint8Array {
  const full: Certificate = { ...cert, keyId: deriveKeyId(cert.publicKey) };
  const body = encodeCertificateBody(full);
  return encodeSignedObject({ body, signature: signWithContext(Context.cert, body, rootSecretKey) });
}

/** Create a root-signed revocation list. */
export function createRevocationList(rootSecretKey: Uint8Array, list: RevocationList): Uint8Array {
  const body = encodeRevocationBody(list);
  return encodeSignedObject({ body, signature: signWithContext(Context.revocation, body, rootSecretKey) });
}

/**
 * Sign an alert with an issuer key. `issuerKeyId` is filled in from the key.
 * Returns an envelope with hops = 0, ready for push or mesh.
 */
export function signAlert(issuerSecretKey: Uint8Array, alert: Omit<Alert, 'issuerKeyId'>): Uint8Array {
  const full: Alert = { ...alert, issuerKeyId: deriveKeyId(getPublicKey(issuerSecretKey)) };
  const body = encodeAlertBody(full);
  return encodeAlertEnvelope({ body, signature: signWithContext(Context.alert, body, issuerSecretKey), hops: 0 });
}

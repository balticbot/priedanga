import { decode, encode, type CborMap, type CborValue } from './cbor.js';
import { deriveKeyId } from './crypto.js';
import {
  asArray,
  asMap,
  bytes,
  fail,
  isTimestamp,
  oneOf,
  rejectUnknownKeys,
  text,
  uint,
  validateAreas,
  validateSortedBytesList,
} from './fields.js';
import {
  ALERT_ID_BYTES,
  CertKey,
  FORMAT_VERSION,
  KEY_ID_BYTES,
  MAX_AREA_CODE,
  MAX_NAME_BYTES,
  NATIONWIDE,
  PUBLIC_KEY_BYTES,
  RevocationKey,
  Role,
  SIGNATURE_BYTES,
  type Certificate,
  type RevocationList,
} from './model.js';

// ---------------------------------------------------------------------------
// Signed object envelope: [body, signature]   (certificates, revocation lists)
// ---------------------------------------------------------------------------

export interface SignedObject {
  body: Uint8Array;
  signature: Uint8Array;
}

export function encodeSignedObject(obj: SignedObject): Uint8Array {
  if (obj.signature.length !== SIGNATURE_BYTES) fail('signature must be 64 bytes');
  return encode([obj.body, obj.signature]);
}

export function decodeSignedObject(input: Uint8Array): SignedObject {
  const arr = asArray(decode(input), 'signed object');
  if (arr.length !== 2) fail('signed object must have 2 elements');
  return { body: bytes(arr[0], 'body'), signature: bytes(arr[1], 'signature', SIGNATURE_BYTES) };
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

export function validateCertificate(cert: Certificate): void {
  if (cert.publicKey.length !== PUBLIC_KEY_BYTES) fail('publicKey must be 32 bytes');
  if (cert.keyId.length !== KEY_ID_BYTES) fail('keyId must be 8 bytes');
  const expected = deriveKeyId(cert.publicKey);
  if (!expected.every((b, i) => b === cert.keyId[i])) fail('keyId does not match publicKey');
  oneOf(cert.role, Role, 'role');
  if (!isTimestamp(cert.validFrom) || !isTimestamp(cert.validTo)) fail('validity must be unsigned integers');
  if (cert.validTo <= cert.validFrom) fail('validTo must be after validFrom');
  if (cert.role === Role.Content) {
    if (cert.areas !== undefined) fail('content certificates must not carry areas');
  } else {
    if (cert.areas === undefined) fail('issuer certificates require areas');
    validateAreas(cert.areas, 'areas', MAX_AREA_CODE, NATIONWIDE);
  }
  text(cert.name, 'name', MAX_NAME_BYTES);
}

export function encodeCertificateBody(cert: Certificate): Uint8Array {
  validateCertificate(cert);
  const m: CborMap = new Map<number, CborValue>([
    [CertKey.v, FORMAT_VERSION],
    [CertKey.keyId, cert.keyId],
    [CertKey.publicKey, cert.publicKey],
    [CertKey.role, cert.role],
    [CertKey.validFrom, cert.validFrom],
    [CertKey.validTo, cert.validTo],
    [CertKey.name, cert.name],
  ]);
  if (cert.areas !== undefined) m.set(CertKey.areas, [...cert.areas]);
  return encode(m);
}

export function decodeCertificateBody(body: Uint8Array): Certificate {
  const m = asMap(decode(body), 'certificate');
  rejectUnknownKeys(m, CertKey, 'certificate');
  if (uint(m.get(CertKey.v), 'v') !== FORMAT_VERSION) fail('unsupported certificate version');
  const cert: Certificate = {
    keyId: bytes(m.get(CertKey.keyId), 'keyId', KEY_ID_BYTES),
    publicKey: bytes(m.get(CertKey.publicKey), 'publicKey', PUBLIC_KEY_BYTES),
    role: oneOf(uint(m.get(CertKey.role), 'role'), Role, 'role'),
    validFrom: uint(m.get(CertKey.validFrom), 'validFrom'),
    validTo: uint(m.get(CertKey.validTo), 'validTo'),
    name: text(m.get(CertKey.name), 'name', MAX_NAME_BYTES),
  };
  if (m.has(CertKey.areas)) {
    cert.areas = asArray(m.get(CertKey.areas)!, 'areas').map((a) => uint(a, 'area', MAX_AREA_CODE));
  }
  validateCertificate(cert);
  return cert;
}

// ---------------------------------------------------------------------------
// Revocation lists
// ---------------------------------------------------------------------------

export function validateRevocationList(list: RevocationList): void {
  if (!isTimestamp(list.seq) || !isTimestamp(list.issued)) fail('seq and issued must be unsigned integers');
  validateSortedBytesList(list.keyIds, 'keyIds', KEY_ID_BYTES);
  validateSortedBytesList(list.alertIds, 'alertIds', ALERT_ID_BYTES);
}

export function encodeRevocationBody(list: RevocationList): Uint8Array {
  validateRevocationList(list);
  return encode(
    new Map<number, CborValue>([
      [RevocationKey.v, FORMAT_VERSION],
      [RevocationKey.seq, list.seq],
      [RevocationKey.issued, list.issued],
      [RevocationKey.keyIds, [...list.keyIds]],
      [RevocationKey.alertIds, [...list.alertIds]],
    ]),
  );
}

export function decodeRevocationBody(body: Uint8Array): RevocationList {
  const m = asMap(decode(body), 'revocation list');
  rejectUnknownKeys(m, RevocationKey, 'revocation list');
  if (uint(m.get(RevocationKey.v), 'v') !== FORMAT_VERSION) fail('unsupported revocation list version');
  const list: RevocationList = {
    seq: uint(m.get(RevocationKey.seq), 'seq'),
    issued: uint(m.get(RevocationKey.issued), 'issued'),
    keyIds: asArray(m.get(RevocationKey.keyIds) ?? fail('keyIds is required'), 'keyIds').map((k) =>
      bytes(k, 'keyId', KEY_ID_BYTES),
    ),
    alertIds: asArray(m.get(RevocationKey.alertIds) ?? fail('alertIds is required'), 'alertIds').map((k) =>
      bytes(k, 'alertId', ALERT_ID_BYTES),
    ),
  };
  validateRevocationList(list);
  return list;
}

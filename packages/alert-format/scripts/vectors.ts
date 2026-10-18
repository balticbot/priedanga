/**
 * Deterministic test-vector generation.
 *
 * Every key below is derived from a PUBLIC seed string and is for TESTS ONLY.
 * These keys must never be used to sign anything outside the test suite.
 *
 * Ed25519 signatures are deterministic, so running this twice produces
 * byte-identical output; the test suite checks the committed JSON matches.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { decodeAlertBody, decodeAlertEnvelope, encodeAlertBody, encodeAlertEnvelope, withHops } from '../src/alert.js';
import { encodeSignedObject } from '../src/cert.js';
import { decode, encode, type CborMap } from '../src/cbor.js';
import { Context, deriveKeyId, generateSecretKey, getPublicKey, signWithContext } from '../src/crypto.js';
import { createCertificate, createRevocationList, signAlert } from '../src/issue.js';
import {
  AlertKey,
  Category,
  CertKey,
  FORMAT_VERSION,
  Level,
  MsgType,
  NATIONWIDE,
  Role,
  type Alert,
} from '../src/model.js';
import type { VerifyFailure } from '../src/verify.js';
import { encodeUtf8 } from '../src/utf8.js';

export const NOW = 1_800_000_000; // 2027-01-15T08:00:00Z
const DAY = 86_400;

function testKey(name: string): { sk: Uint8Array; pk: Uint8Array; keyId: Uint8Array } {
  const sk = generateSecretKey(sha256(encodeUtf8(`priedanga TEST-ONLY key, never use in production: ${name}`)));
  const pk = getPublicKey(sk);
  return { sk, pk, keyId: deriveKeyId(pk) };
}

function vectorId(name: string): Uint8Array {
  return sha256(encodeUtf8(`priedanga test vector id: ${name}`)).slice(0, 16);
}

export interface AlertVector {
  name: string;
  description: string;
  envelope: string;
  expect: 'OK' | VerifyFailure;
  /** For OK vectors: the decoded fields every implementation must agree on. */
  decoded?: {
    id: string;
    issuerKeyId: string;
    issued: number;
    expires: number;
    msgType: number;
    ref?: string;
    level?: number;
    category?: number;
    template?: number;
    areas: number[];
    text?: Record<string, string>;
    test: boolean;
    hops: number;
  };
}

export interface CertificateVector {
  name: string;
  description: string;
  certificate: string;
  expect: 'OK' | 'MALFORMED' | 'BAD_SIGNATURE';
}

export interface VectorFile {
  format: 'priedanga-alert-format-test-vectors';
  version: number;
  warning: string;
  now: number;
  policy: { maxEnvelopeBytes: number; maxHops: number; clockSkewSeconds: number; maxLifetimeSeconds: number };
  trust: { rootPublicKey: string; certificates: string[]; revocation: string };
  certificateVectors: CertificateVector[];
  alertVectors: AlertVector[];
}

export function buildVectors(): VectorFile {
  const root = testKey('root');
  const otherRoot = testKey('other-root');
  const live = testKey('live-issuer');
  const test = testKey('test-issuer');
  const content = testKey('content');
  const scoped = testKey('scoped-test-issuer');
  const expired = testKey('expired-test-issuer');
  const revoked = testKey('revoked-test-issuer');
  const unknown = testKey('uncertified-issuer');

  const window = { validFrom: NOW - 365 * DAY, validTo: NOW + 365 * DAY };
  const certificates = [
    createCertificate(root.sk, { publicKey: live.pk, role: Role.LiveIssuer, ...window, areas: [NATIONWIDE], name: 'TEST VECTOR live issuer' }),
    createCertificate(root.sk, { publicKey: test.pk, role: Role.TestIssuer, ...window, areas: [NATIONWIDE], name: 'TEST VECTOR test issuer' }),
    createCertificate(root.sk, { publicKey: content.pk, role: Role.Content, ...window, name: 'TEST VECTOR content key' }),
    createCertificate(root.sk, { publicKey: scoped.pk, role: Role.TestIssuer, ...window, areas: [13, 19], name: 'TEST VECTOR scoped issuer (areas 13, 19)' }),
    createCertificate(root.sk, { publicKey: expired.pk, role: Role.TestIssuer, validFrom: NOW - 400 * DAY, validTo: NOW - 30 * DAY, areas: [NATIONWIDE], name: 'TEST VECTOR expired issuer' }),
    createCertificate(root.sk, { publicKey: revoked.pk, role: Role.TestIssuer, ...window, areas: [NATIONWIDE], name: 'TEST VECTOR revoked issuer' }),
  ];

  const revokedAlertId = vectorId('revoked-alert');
  const revocation = createRevocationList(root.sk, {
    seq: 1,
    issued: NOW - DAY,
    keyIds: [revoked.keyId],
    alertIds: [revokedAlertId],
  });

  // ---- certificate vectors (trust-store building) ----
  const certificateVectors: CertificateVector[] = [
    { name: 'cert_valid', description: 'Root-signed test issuer certificate', certificate: hex(certificates[1]!), expect: 'OK' },
    {
      name: 'cert_wrong_root',
      description: 'Certificate signed by a key other than the pinned root',
      certificate: hex(createCertificate(otherRoot.sk, { publicKey: unknown.pk, role: Role.TestIssuer, ...window, areas: [NATIONWIDE], name: 'rogue' })),
      expect: 'BAD_SIGNATURE',
    },
    {
      name: 'cert_wrong_context',
      description: 'Root signature made with the alert context instead of the cert context (domain separation)',
      certificate: hex(resignObject(certificates[1]!, Context.alert, root.sk)),
      expect: 'BAD_SIGNATURE',
    },
    {
      name: 'cert_keyid_mismatch',
      description: 'Root-signed certificate whose keyId does not match its public key',
      certificate: hex(
        signedCert(root.sk, (m) => {
          m.set(CertKey.keyId, deriveKeyId(unknown.pk));
        }, certificates[1]!),
      ),
      expect: 'MALFORMED',
    },
    {
      name: 'cert_content_with_areas',
      description: 'Root-signed content certificate that carries areas',
      certificate: hex(
        signedCert(root.sk, (m) => {
          m.set(CertKey.areas, [NATIONWIDE]);
        }, certificates[2]!),
      ),
      expect: 'MALFORMED',
    },
  ];

  // ---- alert vectors ----
  const base = (name: string, over: Partial<Omit<Alert, 'issuerKeyId'>> = {}): Omit<Alert, 'issuerKeyId'> => ({
    id: vectorId(name),
    issued: NOW - 60,
    expires: NOW + 3600,
    msgType: MsgType.Alert,
    level: Level.Red,
    category: Category.Air,
    template: 1,
    areas: [NATIONWIDE],
    test: true,
    ...over,
  });

  const vectors: { name: string; description: string; envelope: Uint8Array; expect: AlertVector['expect'] }[] = [];
  const add = (name: string, description: string, envelope: Uint8Array, expect: AlertVector['expect']) =>
    vectors.push({ name, description, envelope, expect });

  const validRed = signAlert(test.sk, base('valid_red_nationwide'));

  // Valid
  add('valid_red_nationwide', 'Test issuer, red air alert, nationwide, template only', validRed, 'OK');
  add('valid_with_text', 'Free text in all five languages, including non-ASCII', signAlert(test.sk, base('valid_with_text', {
    text: {
      lt: 'Oro pavojus. Nedelsdami eikite į artimiausią priedangą.',
      en: 'Air raid alert. Go to the nearest shelter immediately.',
      ru: 'Воздушная тревога. Немедленно идите в ближайшее укрытие.',
      pl: 'Alarm lotniczy. Natychmiast udaj się do najbliższego schronu.',
      uk: 'Повітряна тривога. Негайно йдіть до найближчого укриття.',
    },
  })), 'OK');
  add('valid_live', 'Live issuer, live (non-test) alert', signAlert(live.sk, base('valid_live', { test: false })), 'OK');
  add('valid_yellow_after_red', 'Level yellow-after-red', signAlert(test.sk, base('valid_yellow_after_red', { level: Level.YellowAfterRed })), 'OK');
  add('valid_white', 'Level white (all clear)', signAlert(test.sk, base('valid_white', { level: Level.White })), 'OK');
  add('valid_update', 'Update referencing a previous alert', signAlert(test.sk, base('valid_update', {
    msgType: MsgType.Update, ref: vectorId('valid_red_nationwide'), level: Level.Yellow,
  })), 'OK');
  const cancel = base('valid_cancel', { msgType: MsgType.Cancel, ref: vectorId('valid_red_nationwide') });
  delete cancel.level;
  delete cancel.category;
  delete cancel.template;
  add('valid_cancel', 'Cancel referencing a previous alert (no level/category/template)', signAlert(test.sk, cancel), 'OK');
  add('valid_scoped_single', 'Scoped issuer, area within scope', signAlert(scoped.sk, base('valid_scoped_single', { areas: [13] })), 'OK');
  add('valid_scoped_both', 'Scoped issuer, both allowed areas', signAlert(scoped.sk, base('valid_scoped_both', { areas: [13, 19] })), 'OK');
  add('valid_hops_5', 'Relayed 5 hops (hop counter is outside the signature)', withHops(validRed, 5), 'OK');
  add('valid_hops_max', 'Relayed exactly maxHops hops', withHops(validRed, 16), 'OK');
  add('valid_issued_at_skew_limit', 'Issued exactly clockSkewSeconds in the future', signAlert(test.sk, base('valid_issued_at_skew_limit', {
    issued: NOW + 300, expires: NOW + 3900,
  })), 'OK');
  add('valid_lifetime_max', 'Lifetime exactly maxLifetimeSeconds', signAlert(test.sk, base('valid_lifetime_max', {
    issued: NOW - 60, expires: NOW - 60 + 7 * DAY,
  })), 'OK');

  // Signature / issuer
  add('bad_signature', 'Signature with one bit flipped', mutateEnvelope(validRed, (e) => {
    const sig = e.signature.slice();
    sig[0]! ^= 0x01;
    return { ...e, signature: sig };
  }), 'BAD_SIGNATURE');
  add('tampered_body', 'Body changed (template 1 -> 2) after signing; canonical encoding preserved', mutateEnvelope(validRed, (e) => {
    const m = decode(e.body) as CborMap;
    m.set(AlertKey.template, 2);
    return { ...e, body: encode(m) };
  }), 'BAD_SIGNATURE');
  add('wrong_context', 'Issuer signed the body with the cert context (domain separation)', mutateEnvelope(validRed, (e) => ({
    ...e, signature: signWithContext(Context.cert, e.body, test.sk),
  })), 'BAD_SIGNATURE');
  add('unknown_issuer', 'Signed by a key with no certificate', signAlert(unknown.sk, base('unknown_issuer')), 'UNKNOWN_ISSUER');
  add('revoked_issuer', 'Signed by a revoked issuer', signAlert(revoked.sk, base('revoked_issuer')), 'ISSUER_REVOKED');
  add('content_key_signs_alert', 'Content key cannot sign alerts', signAlert(content.sk, base('content_key_signs_alert')), 'ROLE_NOT_ALLOWED');
  add('test_alert_by_live_issuer', 'Test alert signed by a live issuer', signAlert(live.sk, base('test_alert_by_live_issuer')), 'TEST_MISMATCH');
  add('live_alert_by_test_issuer', 'Live alert signed by a test issuer', signAlert(test.sk, base('live_alert_by_test_issuer', { test: false })), 'TEST_MISMATCH');
  add('issuer_cert_expired', 'Issued after the issuer certificate expired', signAlert(expired.sk, base('issuer_cert_expired')), 'ISSUER_NOT_VALID');
  add('area_outside_scope', 'Scoped issuer targets an area outside its scope', signAlert(scoped.sk, base('area_outside_scope', { areas: [5] })), 'AREA_NOT_ALLOWED');
  add('area_partially_outside_scope', 'Scoped issuer, one of two areas outside scope', signAlert(scoped.sk, base('area_partially_outside_scope', { areas: [13, 20] })), 'AREA_NOT_ALLOWED');
  add('scoped_issuer_nationwide', 'Scoped issuer cannot send nationwide', signAlert(scoped.sk, base('scoped_issuer_nationwide')), 'AREA_NOT_ALLOWED');

  // Time
  add('expired', 'expires == now', signAlert(test.sk, base('expired', { issued: NOW - 3600, expires: NOW })), 'EXPIRED');
  add('issued_in_future', 'Issued beyond clock skew tolerance', signAlert(test.sk, base('issued_in_future', {
    issued: NOW + 301, expires: NOW + 4000,
  })), 'NOT_YET_VALID');
  add('lifetime_too_long', 'Lifetime one second over maxLifetimeSeconds', signAlert(test.sk, base('lifetime_too_long', {
    issued: NOW - 60, expires: NOW - 60 + 7 * DAY + 1,
  })), 'LIFETIME_TOO_LONG');

  // Revocation / relay
  add('revoked_alert_id', 'Alert ID is on the revocation list', signAlert(test.sk, base('revoked_alert_id', { id: revokedAlertId })), 'ALERT_REVOKED');
  add('hops_exceeded', 'Hop counter above maxHops', withHops(validRed, 17), 'HOPS_EXCEEDED');

  // Encoding strictness (bodies are correctly signed, but not canonical / not schema-valid)
  const validBody = decodeAlertEnvelope(validRed).body;
  if (validBody[1] !== 0x00 || validBody[2] !== 0x01 || validBody[3] !== 0x01 || validBody[4] !== 0x50) {
    throw new Error('unexpected canonical body layout; update the crafted vectors');
  }
  add('non_minimal_integer', 'Version field encoded as 0x18 0x01 instead of 0x01', signRawBody(test.sk, Uint8Array.from([
    validBody[0]!, 0x00, 0x18, 0x01, ...validBody.subarray(3),
  ])), 'MALFORMED');
  add('unsorted_map_keys', 'Map keys 1 and 0 swapped', signRawBody(test.sk, Uint8Array.from([
    validBody[0]!, ...validBody.subarray(3, 21), 0x00, 0x01, ...validBody.subarray(21),
  ])), 'MALFORMED');
  add('unknown_body_field', 'Extra field 13 in the body', signRawBody(test.sk, mapEdit(validBody, (m) => m.set(13, 'x'))), 'MALFORMED');
  add('cancel_with_level', 'Cancel carrying a level', signRawBody(test.sk, mapEdit(encodeAlertBody({
    ...cancel, issuerKeyId: test.keyId,
  }), (m) => m.set(AlertKey.level, Level.Red))), 'MALFORMED');
  add('update_without_ref', 'Update with no ref', signRawBody(test.sk, mapEdit(encodeAlertBody({
    ...base('update_without_ref', { msgType: MsgType.Update, ref: vectorId('x') }), issuerKeyId: test.keyId,
  }), (m) => m.delete(AlertKey.ref))), 'MALFORMED');
  add('areas_unsorted', 'Area list not sorted', signRawBody(test.sk, mapEdit(encodeAlertBody({
    ...base('areas_unsorted', { areas: [13, 19] }), issuerKeyId: test.keyId,
  }), (m) => m.set(AlertKey.areas, [19, 13]))), 'MALFORMED');
  add('envelope_trailing_bytes', 'One extra byte after the envelope', Uint8Array.from([...validRed, 0x00]), 'MALFORMED');
  add('envelope_indefinite_length', 'Envelope array encoded with indefinite length', Uint8Array.from([
    0x9f, ...validRed.subarray(1), 0xff,
  ]), 'MALFORMED');
  add('unsupported_version', 'Envelope version 2', mutateEnvelope(validRed, (e) => ({ ...e, version: 2 })), 'UNSUPPORTED_VERSION');
  add('too_large', 'Envelope above maxEnvelopeBytes (long text in all languages)', signAlert(test.sk, base('too_large', {
    text: { lt: 'a'.repeat(300), en: 'b'.repeat(300), ru: 'c'.repeat(300), pl: 'd'.repeat(300), uk: 'e'.repeat(300) },
  })), 'TOO_LARGE');

  return {
    format: 'priedanga-alert-format-test-vectors',
    version: FORMAT_VERSION,
    warning: 'All keys are derived from public seeds and are for TESTS ONLY. Never trust them in production.',
    now: NOW,
    policy: { maxEnvelopeBytes: 1024, maxHops: 16, clockSkewSeconds: 300, maxLifetimeSeconds: 7 * DAY },
    trust: { rootPublicKey: hex(root.pk), certificates: certificates.map(hex), revocation: hex(revocation) },
    certificateVectors,
    alertVectors: vectors.map((v) => {
      const out: AlertVector = { ...v, envelope: hex(v.envelope) };
      if (v.expect === 'OK') out.decoded = summarize(v.envelope);
      return out;
    }),
  };
}

function summarize(envelope: Uint8Array): NonNullable<AlertVector['decoded']> {
  const env = decodeAlertEnvelope(envelope);
  const a = decodeAlertBody(env.body);
  const d: NonNullable<AlertVector['decoded']> = {
    id: hex(a.id),
    issuerKeyId: hex(a.issuerKeyId),
    issued: a.issued,
    expires: a.expires,
    msgType: a.msgType,
    areas: a.areas,
    test: a.test,
    hops: env.hops,
  };
  if (a.ref !== undefined) d.ref = hex(a.ref);
  if (a.level !== undefined) d.level = a.level;
  if (a.category !== undefined) d.category = a.category;
  if (a.template !== undefined) d.template = a.template;
  if (a.text !== undefined) d.text = a.text as Record<string, string>;
  return d;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function hex(b: Uint8Array): string {
  return bytesToHex(b);
}

type Env = { version: number; body: Uint8Array; signature: Uint8Array; hops: number };

function mutateEnvelope(envelope: Uint8Array, fn: (e: Env) => Env): Uint8Array {
  return encodeAlertEnvelope(fn(decodeAlertEnvelope(envelope)));
}

/** Sign arbitrary body bytes with the alert context, bypassing validation. */
function signRawBody(sk: Uint8Array, body: Uint8Array): Uint8Array {
  return encodeAlertEnvelope({ body, signature: signWithContext(Context.alert, body, sk), hops: 0 });
}

function mapEdit(body: Uint8Array, fn: (m: CborMap) => void): Uint8Array {
  const m = decode(body) as CborMap;
  fn(m);
  return encode(m);
}

function resignObject(signedObject: Uint8Array, context: Context, sk: Uint8Array): Uint8Array {
  const [body] = decode(signedObject) as [Uint8Array, Uint8Array];
  return encodeSignedObject({ body, signature: signWithContext(context, body, sk) });
}

function signedCert(rootSk: Uint8Array, edit: (m: CborMap) => void, template: Uint8Array): Uint8Array {
  const [body] = decode(template) as [Uint8Array, Uint8Array];
  const edited = mapEdit(body, edit);
  return encodeSignedObject({ body: edited, signature: signWithContext(Context.cert, edited, rootSk) });
}

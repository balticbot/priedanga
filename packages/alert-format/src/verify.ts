import { decodeAlertBody, decodeAlertEnvelope } from './alert.js';
import { decodeCertificateBody, decodeRevocationBody, decodeSignedObject, type SignedObject } from './cert.js';
import { CborError } from './cbor.js';
import { Context, type Ed25519Verifier } from './crypto.js';
import { FormatError } from './fields.js';
import {
  FORMAT_VERSION,
  isRelayRole,
  isTestRole,
  NATIONWIDE,
  PUBLIC_KEY_BYTES,
  Role,
  type Alert,
  type Certificate,
  type RevocationList,
} from './model.js';
import { runAsync, runSync, type Checks, type SignatureCheck } from './sigcheck.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface VerifyPolicy {
  /** Reject envelopes larger than this before decoding anything. */
  maxEnvelopeBytes: number;
  /** Maximum relay hops accepted. */
  maxHops: number;
  /** Tolerated clock difference between issuer and device, in seconds. */
  clockSkewSeconds: number;
  /** Maximum expires - issued, in seconds. Also bounds how long a stolen expired key stays useful. */
  maxLifetimeSeconds: number;
}

export const DEFAULT_POLICY: Readonly<VerifyPolicy> = Object.freeze({
  maxEnvelopeBytes: 1024,
  maxHops: 16,
  clockSkewSeconds: 300,
  maxLifetimeSeconds: 7 * 24 * 3600,
});

// ---------------------------------------------------------------------------
// Trust store
// ---------------------------------------------------------------------------

export interface TrustStore {
  /** Pinned root public key (shipped in the app binary). */
  readonly rootPublicKey: Uint8Array;
  /** Root-verified certificates, keyed by hex key ID. */
  readonly certificates: ReadonlyMap<string, Certificate>;
  readonly revocation: RevocationList | undefined;
  /** Hex key IDs / alert IDs from the revocation list, for O(1) lookup. */
  readonly revokedKeyIds: ReadonlySet<string>;
  readonly revokedAlertIds: ReadonlySet<string>;
}

export type TrustRejectReason = 'MALFORMED' | 'BAD_SIGNATURE' | 'DUPLICATE_KEY_ID';

export interface BuildTrustStoreResult {
  store: TrustStore;
  /** Certificates (by input index) or the revocation list that were rejected, and why. */
  rejected: { item: number | 'revocation'; reason: TrustRejectReason; detail?: string }[];
}

export interface TrustStoreInput {
  rootPublicKey: Uint8Array;
  certificates: readonly Uint8Array[];
  revocation?: Uint8Array;
}

/**
 * Verify certificates and the revocation list against the pinned root and
 * build a trust store. Invalid items are dropped and reported, never trusted.
 */
export function buildTrustStore(input: TrustStoreInput): BuildTrustStoreResult {
  return runSync(buildTrustStoreSteps(input));
}

/**
 * {@link buildTrustStore} with an injected Ed25519 verifier (e.g. native).
 * All signatures are checked concurrently; results are identical to the
 * synchronous version for any conforming verifier.
 */
export function buildTrustStoreAsync(input: TrustStoreInput, verify?: Ed25519Verifier): Promise<BuildTrustStoreResult> {
  return runAsync(buildTrustStoreSteps(input), verify);
}

function* buildTrustStoreSteps(input: TrustStoreInput): Checks<BuildTrustStoreResult> {
  if (input.rootPublicKey.length !== PUBLIC_KEY_BYTES) throw new Error('root public key must be 32 bytes');
  const rejected: BuildTrustStoreResult['rejected'] = [];
  const certificates = new Map<string, Certificate>();

  // Decode every signed wrapper first, so all signatures go out as one batch.
  const decode = (encoded: Uint8Array): SignedObject | { error: string } => {
    try {
      return decodeSignedObject(encoded);
    } catch (e) {
      return { error: errorDetail(e) };
    }
  };
  const certs = input.certificates.map(decode);
  const revocationSigned = input.revocation === undefined ? undefined : decode(input.revocation);
  const checks: SignatureCheck[] = [];
  const checkIndex = new Map<SignedObject, number>();
  const ask = (signed: SignedObject | { error: string } | undefined, context: Context) => {
    if (signed === undefined || 'error' in signed) return;
    checkIndex.set(signed, checks.length);
    checks.push({ context, body: signed.body, signature: signed.signature, publicKey: input.rootPublicKey });
  };
  certs.forEach((signed) => ask(signed, Context.cert));
  ask(revocationSigned, Context.revocation);
  const valid = checks.length > 0 ? yield checks : [];
  const signatureOk = (signed: SignedObject): boolean => valid[checkIndex.get(signed)!] === true;

  certs.forEach((signed, index) => {
    if ('error' in signed) {
      rejected.push({ item: index, reason: 'MALFORMED', detail: signed.error });
      return;
    }
    if (!signatureOk(signed)) {
      rejected.push({ item: index, reason: 'BAD_SIGNATURE' });
      return;
    }
    try {
      const cert = decodeCertificateBody(signed.body);
      const id = bytesToHex(cert.keyId);
      if (certificates.has(id)) {
        rejected.push({ item: index, reason: 'DUPLICATE_KEY_ID' });
        return;
      }
      certificates.set(id, cert);
    } catch (e) {
      rejected.push({ item: index, reason: 'MALFORMED', detail: errorDetail(e) });
    }
  });

  let revocation: RevocationList | undefined;
  if (revocationSigned !== undefined) {
    if ('error' in revocationSigned) {
      rejected.push({ item: 'revocation', reason: 'MALFORMED', detail: revocationSigned.error });
    } else if (!signatureOk(revocationSigned)) {
      rejected.push({ item: 'revocation', reason: 'BAD_SIGNATURE' });
    } else {
      try {
        revocation = decodeRevocationBody(revocationSigned.body);
      } catch (e) {
        rejected.push({ item: 'revocation', reason: 'MALFORMED', detail: errorDetail(e) });
      }
    }
  }

  return {
    store: {
      rootPublicKey: input.rootPublicKey,
      certificates,
      revocation,
      revokedKeyIds: new Set(revocation?.keyIds.map(bytesToHex) ?? []),
      revokedAlertIds: new Set(revocation?.alertIds.map(bytesToHex) ?? []),
    },
    rejected,
  };
}

// ---------------------------------------------------------------------------
// Alert verification
// ---------------------------------------------------------------------------

export const VerifyFailure = {
  TOO_LARGE: 'TOO_LARGE',
  MALFORMED: 'MALFORMED',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  UNKNOWN_ISSUER: 'UNKNOWN_ISSUER',
  BAD_SIGNATURE: 'BAD_SIGNATURE',
  ISSUER_REVOKED: 'ISSUER_REVOKED',
  ROLE_NOT_ALLOWED: 'ROLE_NOT_ALLOWED',
  RELAY_MISMATCH: 'RELAY_MISMATCH',
  TEST_MISMATCH: 'TEST_MISMATCH',
  ISSUER_NOT_VALID: 'ISSUER_NOT_VALID',
  AREA_NOT_ALLOWED: 'AREA_NOT_ALLOWED',
  NOT_YET_VALID: 'NOT_YET_VALID',
  EXPIRED: 'EXPIRED',
  LIFETIME_TOO_LONG: 'LIFETIME_TOO_LONG',
  ALERT_REVOKED: 'ALERT_REVOKED',
  HOPS_EXCEEDED: 'HOPS_EXCEEDED',
} as const;
export type VerifyFailure = (typeof VerifyFailure)[keyof typeof VerifyFailure];

export type VerifyResult =
  | {
      ok: true;
      alert: Alert;
      issuer: Certificate;
      hops: number;
      /**
       * True if signed by a relay: the content was copied from `alert.source`
       * and is NOT signed by that authority. UIs must label it as relayed.
       */
      relayed: boolean;
    }
  | { ok: false; reason: VerifyFailure; detail?: string };

function reject(reason: VerifyFailure, detail?: string): VerifyResult {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

function errorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Verify an alert envelope. This is the ONLY function that may decide whether
 * something is shown to a user as an alert. Checks run in a fixed order
 * (see SPEC.md §6); the first failing check determines the reason.
 *
 * @param now Current time in Unix seconds (device clock, sanity-checked by the caller).
 */
export function verifyAlert(
  envelope: Uint8Array,
  store: TrustStore,
  now: number,
  policy: Readonly<VerifyPolicy> = DEFAULT_POLICY,
): VerifyResult {
  return runSync(verifyAlertSteps(envelope, store, now, policy));
}

/**
 * {@link verifyAlert} with an injected Ed25519 verifier (e.g. native). Same
 * checks in the same order; only the signature primitive differs.
 */
export function verifyAlertAsync(
  envelope: Uint8Array,
  store: TrustStore,
  now: number,
  verify?: Ed25519Verifier,
  policy: Readonly<VerifyPolicy> = DEFAULT_POLICY,
): Promise<VerifyResult> {
  return runAsync(verifyAlertSteps(envelope, store, now, policy), verify);
}

function* verifyAlertSteps(
  envelope: Uint8Array,
  store: TrustStore,
  now: number,
  policy: Readonly<VerifyPolicy>,
): Checks<VerifyResult> {
  // 1. Size, before any parsing.
  if (envelope.length > policy.maxEnvelopeBytes) return reject('TOO_LARGE');

  // 2. Envelope structure and version.
  let env;
  try {
    env = decodeAlertEnvelope(envelope);
  } catch (e) {
    return reject('MALFORMED', errorDetail(e));
  }
  if (env.version !== FORMAT_VERSION) return reject('UNSUPPORTED_VERSION');

  // 3. Body structure. Strict decoding, so the signed bytes have exactly one meaning.
  let alert: Alert;
  try {
    alert = decodeAlertBody(env.body);
  } catch (e) {
    if (e instanceof CborError || e instanceof FormatError) return reject('MALFORMED', e.message);
    throw e;
  }

  // 4. Issuer lookup and signature over the exact received body bytes.
  const issuer = store.certificates.get(bytesToHex(alert.issuerKeyId));
  if (issuer === undefined) return reject('UNKNOWN_ISSUER');
  const [signatureOk] = yield [
    { context: Context.alert, body: env.body, signature: env.signature, publicKey: issuer.publicKey },
  ];
  if (signatureOk !== true) return reject('BAD_SIGNATURE');

  // 5. Issuer authorisation.
  if (store.revokedKeyIds.has(bytesToHex(issuer.keyId))) return reject('ISSUER_REVOKED');
  if (issuer.role === Role.Content) return reject('ROLE_NOT_ALLOWED');
  const relayed = isRelayRole(issuer.role);
  if (relayed !== (alert.source !== undefined)) return reject('RELAY_MISMATCH');
  if (alert.test !== isTestRole(issuer.role)) return reject('TEST_MISMATCH');
  if (alert.issued < issuer.validFrom || alert.issued > issuer.validTo) return reject('ISSUER_NOT_VALID');
  if (!areasAllowed(alert.areas, issuer.areas ?? [])) return reject('AREA_NOT_ALLOWED');

  // 6. Time.
  if (alert.issued > now + policy.clockSkewSeconds) return reject('NOT_YET_VALID');
  if (alert.expires <= now) return reject('EXPIRED');
  if (alert.expires - alert.issued > policy.maxLifetimeSeconds) return reject('LIFETIME_TOO_LONG');

  // 7. Alert revocation and relay limits.
  if (store.revokedAlertIds.has(bytesToHex(alert.id))) return reject('ALERT_REVOKED');
  if (env.hops > policy.maxHops) return reject('HOPS_EXCEEDED');

  return { ok: true, alert, issuer, hops: env.hops, relayed };
}

/** True if every alert area is covered by the issuer's allowed areas. */
export function areasAllowed(alertAreas: readonly number[], issuerAreas: readonly number[]): boolean {
  if (issuerAreas.length === 1 && issuerAreas[0] === NATIONWIDE) return true;
  if (alertAreas.includes(NATIONWIDE)) return false;
  return alertAreas.every((a) => issuerAreas.includes(a));
}

/**
 * Local relevance filter: does this (already verified) alert apply to the
 * device's area? Runs entirely on the device; no location leaves the phone.
 */
export function appliesToArea(alert: Alert, areaCode: number): boolean {
  return alert.areas.includes(NATIONWIDE) || alert.areas.includes(areaCode);
}

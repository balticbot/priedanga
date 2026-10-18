/**
 * Conformance check for an injected Ed25519 verifier (normally the native
 * one): every alert-format test vector and every Ed25519 strictness vector is
 * run through it and compared with the JS reference. Used by the unit tests
 * (with the macOS CryptoKit build of the native code) and by the in-app dev
 * check on real devices.
 */

import {
  buildTrustStore,
  buildTrustStoreAsync,
  verifyAlert,
  verifyAlertAsync,
  type BuildTrustStoreResult,
  type Ed25519Verifier,
  type VerifyResult,
} from '@priedanga/alert-format';
import { hexToBytes } from '../pack/hex';

/** The parts of packages/alert-format/test-vectors/v1.json used here. */
export interface FormatVectors {
  now: number;
  trust: { rootPublicKey: string; certificates: string[]; revocation: string };
  certificateVectors: { name: string; certificate: string }[];
  alertVectors: { name: string; envelope: string }[];
}

/** packages/alert-format/test-vectors/ed25519-strict.json */
export interface StrictVectors {
  vectors: {
    name: string;
    signature: string;
    message: string;
    publicKey: string;
    expect: boolean;
    cofactorDependent?: true;
  }[];
}

export interface ConformanceReport {
  /** Vectors compared (format + strictness). */
  compared: number;
  /** Signature verifications the injected verifier performed. */
  verifierCalls: number;
  /** Vectors where the injected verifier disagrees with the reference. Must be empty. */
  mismatches: string[];
  /** Results on the cofactor-dependent vectors (implementation-defined, SPEC.md §3.1). */
  cofactorDependent: { name: string; result: boolean }[];
  /** Total time, including the JS reference runs it compares against. */
  ms: number;
  /** Time spent inside the injected verifier only. */
  verifierMs: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const trustSummary = (r: BuildTrustStoreResult): string =>
  JSON.stringify({ certs: [...r.store.certificates.keys()].sort(), rejected: r.rejected.map((x) => [x.item, x.reason]), seq: r.store.revocation?.seq });
const alertSummary = (r: VerifyResult): string => (r.ok ? `OK relayed=${r.relayed} hops=${r.hops}` : r.reason);

export async function runEd25519Conformance(
  verify: Ed25519Verifier,
  format: FormatVectors,
  strict: StrictVectors,
): Promise<ConformanceReport> {
  const start = now();
  let verifierCalls = 0;
  let verifierMs = 0;
  const counted: Ed25519Verifier = async (s, m, p) => {
    verifierCalls++;
    const t = now();
    try {
      return await verify(s, m, p);
    } finally {
      verifierMs += now() - t;
    }
  };
  const mismatches: string[] = [];
  const cofactorDependent: ConformanceReport['cofactorDependent'] = [];
  let compared = 0;

  for (const v of strict.vectors) {
    compared++;
    let result: boolean;
    try {
      result = (await counted(hexToBytes(v.signature), hexToBytes(v.message), hexToBytes(v.publicKey))) === true;
    } catch {
      result = false;
    }
    if (v.cofactorDependent) cofactorDependent.push({ name: v.name, result });
    else if (result !== v.expect) mismatches.push(`ed25519:${v.name}`);
  }

  const rootPublicKey = hexToBytes(format.trust.rootPublicKey);
  const trustInput = {
    rootPublicKey,
    certificates: format.trust.certificates.map(hexToBytes),
    revocation: hexToBytes(format.trust.revocation),
  };
  compared++;
  const reference = buildTrustStore(trustInput);
  if (trustSummary(await buildTrustStoreAsync(trustInput, counted)) !== trustSummary(reference)) mismatches.push('trust');

  for (const v of format.certificateVectors) {
    compared++;
    const input = { rootPublicKey, certificates: [hexToBytes(v.certificate)] };
    if (trustSummary(await buildTrustStoreAsync(input, counted)) !== trustSummary(buildTrustStore(input))) {
      mismatches.push(`cert:${v.name}`);
    }
  }

  for (const v of format.alertVectors) {
    compared++;
    const envelope = hexToBytes(v.envelope);
    const expected = alertSummary(verifyAlert(envelope, reference.store, format.now));
    const actual = alertSummary(await verifyAlertAsync(envelope, reference.store, format.now, counted));
    if (actual !== expected) mismatches.push(`alert:${v.name} (${actual} != ${expected})`);
  }

  return { compared, verifierCalls, mismatches, cofactorDependent, ms: now() - start, verifierMs };
}

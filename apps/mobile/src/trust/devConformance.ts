/**
 * In-app dev check: run every test vector through the platform's native
 * Ed25519 verifier and compare with the JS reference. Loaded lazily from the
 * dev-build pack line, so the vector files stay out of the startup path.
 */
import format from '@priedanga/alert-format/test-vectors/v1.json';
import strict from '@priedanga/alert-format/test-vectors/ed25519-strict.json';
import { ed25519Implementation, verifyEd25519 } from '../../modules/priedanga-crypto/src';
import { runEd25519Conformance, type FormatVectors, type StrictVectors } from './ed25519Conformance';

export async function runNativeConformance(): Promise<{ ok: boolean; summary: string }> {
  const r = await runEd25519Conformance(verifyEd25519, format as FormatVectors, strict as StrictVectors);
  const matched = r.compared - r.mismatches.length;
  const cofactor = r.cofactorDependent.every((c) => !c.result)
    ? 'cofactorless'
    : r.cofactorDependent.every((c) => c.result)
      ? 'cofactored'
      : 'mixed cofactor results';
  const summary =
    `Ed25519 ${ed25519Implementation}: ${matched}/${r.compared} vectors match JS · ${cofactor} · ` +
    `${r.verifierCalls} native verifications in ${r.verifierMs.toFixed(1)} ms` +
    (r.mismatches.length > 0 ? ` · MISMATCH: ${r.mismatches.join(', ')}` : '');
  console.log('[priedanga] native Ed25519 conformance', JSON.stringify(r));
  return { ok: r.mismatches.length === 0, summary };
}

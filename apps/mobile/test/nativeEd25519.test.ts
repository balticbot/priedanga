/**
 * Runs every alert-format test vector and every Ed25519 strictness vector
 * through the native verifier's code (modules/priedanga-crypto/ios/
 * Ed25519Strict.swift, compiled for macOS against the same CryptoKit as iOS)
 * and requires results identical to the JS reference.
 *
 * Skipped where swiftc is unavailable. The Android implementation needs a JVM
 * and is checked on device with the in-app dev check instead.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verifyEd25519, type Ed25519Verifier } from '@priedanga/alert-format';
import { beforeAll, describe, expect, it } from 'vitest';
import { runEd25519Conformance, type FormatVectors, type StrictVectors } from '../src/trust/ed25519Conformance';

const vectorsDir = join(__dirname, '../../../packages/alert-format/test-vectors');
const format = JSON.parse(readFileSync(join(vectorsDir, 'v1.json'), 'utf8')) as FormatVectors;
const strict = JSON.parse(readFileSync(join(vectorsDir, 'ed25519-strict.json'), 'utf8')) as StrictVectors;
const moduleDir = join(__dirname, '../modules/priedanga-crypto');

const hasSwift = process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'swiftc']).status === 0;

/** Every (signature, message, publicKey) the conformance run asks for, collected with the JS reference. */
async function collectTriples(): Promise<string[]> {
  const triples = new Set<string>();
  const recorder: Ed25519Verifier = (s, m, p) => {
    triples.add(`${bytesToHex(s)} ${bytesToHex(m)} ${bytesToHex(p)}`);
    return verifyEd25519(s, m, p);
  };
  await runEd25519Conformance(recorder, format, strict);
  return [...triples];
}

describe.skipIf(!hasSwift)('native Ed25519 (CryptoKit, Ed25519Strict.swift)', () => {
  let swiftVerify: Ed25519Verifier;
  let triples: string[];

  beforeAll(async () => {
    const bin = join(mkdtempSync(join(tmpdir(), 'priedanga-ed25519-')), 'conformance');
    execFileSync('xcrun', ['swiftc', '-O', join(moduleDir, 'ios/Ed25519Strict.swift'), join(moduleDir, 'test/main.swift'), '-o', bin]);
    triples = await collectTriples();
    const out = execFileSync(bin, { input: triples.join('\n') + '\n' }).toString().trim().split('\n');
    expect(out).toHaveLength(triples.length);
    const results = new Map(triples.map((t, i) => [t, out[i] === '1']));
    swiftVerify = (s, m, p) => {
      const r = results.get(`${bytesToHex(s)} ${bytesToHex(m)} ${bytesToHex(p)}`);
      if (r === undefined) throw new Error('triple not precomputed');
      return r;
    };
  }, 120_000);

  it('matches the JS reference on every format and strictness vector', async () => {
    const report = await runEd25519Conformance(swiftVerify, format, strict);
    expect(report.mismatches).toEqual([]);
    expect(report.compared).toBe(strict.vectors.length + 1 + format.certificateVectors.length + format.alertVectors.length);
    expect(report.verifierCalls).toBeGreaterThan(format.alertVectors.length);
  });

  it('is cofactorless: rejects the cofactor-dependent vectors (SPEC.md §3.1)', async () => {
    const report = await runEd25519Conformance(swiftVerify, format, strict);
    expect(report.cofactorDependent).toEqual(
      strict.vectors.filter((v) => v.cofactorDependent).map((v) => ({ name: v.name, result: false })),
    );
  });
});

describe('conformance runner', () => {
  it('reports no mismatches for the JS reference itself', async () => {
    const report = await runEd25519Conformance(verifyEd25519, format, strict);
    expect(report.mismatches).toEqual([]);
    expect(report.cofactorDependent.every((c) => c.result)).toBe(true);
  });

  it('catches a lenient verifier that accepts small-order keys', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519.js');
    const lenient: Ed25519Verifier = (s, m, p) => ed25519.verify(s, m, p, { zip215: true });
    const report = await runEd25519Conformance(lenient, format, strict);
    expect(report.mismatches.some((m) => m.startsWith('ed25519:small_order_a_'))).toBe(true);
  });

  it('catches a verifier that accepts everything', async () => {
    const report = await runEd25519Conformance(() => true, format, strict);
    expect(report.mismatches).toContain('alert:bad_signature (OK relayed=false hops=0 != BAD_SIGNATURE)');
  });
});

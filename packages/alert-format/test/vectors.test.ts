import { readFileSync } from 'node:fs';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { buildVectors, type VectorFile } from '../scripts/vectors.js';
import { buildTrustStore, verifyAlert } from '../src/index.js';

const file: VectorFile = JSON.parse(
  readFileSync(new URL('../test-vectors/v1.json', import.meta.url), 'utf8'),
) as VectorFile;

const { store, rejected } = buildTrustStore({
  rootPublicKey: hexToBytes(file.trust.rootPublicKey),
  certificates: file.trust.certificates.map(hexToBytes),
  revocation: hexToBytes(file.trust.revocation),
});

describe('test-vector file', () => {
  it('is up to date with the generator (run `npm run vectors` after format changes)', () => {
    expect(buildVectors()).toEqual(file);
  });

  it('builds a trust store with every listed certificate', () => {
    expect(rejected).toEqual([]);
    expect(store.certificates.size).toBe(file.trust.certificates.length);
    expect(store.revocation?.seq).toBe(1);
  });

  it('uses the same policy as DEFAULT_POLICY', async () => {
    const { DEFAULT_POLICY } = await import('../src/index.js');
    expect({ ...DEFAULT_POLICY }).toEqual(file.policy);
  });
});

describe('certificate vectors', () => {
  it.each(file.certificateVectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const result = buildTrustStore({
      rootPublicKey: hexToBytes(file.trust.rootPublicKey),
      certificates: [hexToBytes(v.certificate)],
    });
    if (v.expect === 'OK') {
      expect(result.rejected).toEqual([]);
      expect(result.store.certificates.size).toBe(1);
    } else {
      expect(result.rejected.map((r) => r.reason)).toEqual([v.expect]);
      expect(result.store.certificates.size).toBe(0);
    }
  });
});

describe('alert vectors', () => {
  it.each(file.alertVectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const result = verifyAlert(hexToBytes(v.envelope), store, file.now);
    if (v.expect === 'OK') {
      expect(result.ok, result.ok ? '' : `${result.reason}: ${result.detail ?? ''}`).toBe(true);
      if (!result.ok) return;
      const a = result.alert;
      const d = v.decoded!;
      expect(bytesToHex(a.id)).toBe(d.id);
      expect(bytesToHex(a.issuerKeyId)).toBe(d.issuerKeyId);
      expect(a.issued).toBe(d.issued);
      expect(a.expires).toBe(d.expires);
      expect(a.msgType).toBe(d.msgType);
      expect(a.ref === undefined ? undefined : bytesToHex(a.ref)).toBe(d.ref);
      expect(a.level).toBe(d.level);
      expect(a.category).toBe(d.category);
      expect(a.template).toBe(d.template);
      expect(a.areas).toEqual(d.areas);
      expect(a.text).toEqual(d.text);
      expect(a.test).toBe(d.test);
      expect(result.hops).toBe(d.hops);
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(v.expect);
    }
  });

  it('covers every failure reason at least once', async () => {
    const { VerifyFailure } = await import('../src/index.js');
    const covered = new Set(file.alertVectors.map((v) => v.expect));
    for (const reason of Object.values(VerifyFailure)) expect(covered, reason).toContain(reason);
  });
});

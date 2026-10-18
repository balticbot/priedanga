import { readFileSync } from 'node:fs';
import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import type { VectorFile } from '../scripts/vectors.js';
import {
  buildTrustStore,
  buildTrustStoreAsync,
  contextMessage,
  Context,
  createCertificate,
  generateSecretKey,
  getPublicKey,
  Role,
  signManifest,
  verifyAlert,
  verifyAlertAsync,
  verifyEd25519,
  verifyManifest,
  verifyManifestAsync,
  type Ed25519Verifier,
} from '../src/index.js';

const file = JSON.parse(readFileSync(new URL('../test-vectors/v1.json', import.meta.url), 'utf8')) as VectorFile;
const trustInput = {
  rootPublicKey: hexToBytes(file.trust.rootPublicKey),
  certificates: file.trust.certificates.map(hexToBytes),
  revocation: hexToBytes(file.trust.revocation),
};

/** Asynchronous wrapper around the JS reference that records every call. */
function recording(): { verify: Ed25519Verifier; calls: Uint8Array[] } {
  const calls: Uint8Array[] = [];
  return {
    calls,
    verify: async (sig, msg, pk) => {
      calls.push(msg);
      await Promise.resolve();
      return verifyEd25519(sig, msg, pk);
    },
  };
}

describe('injected Ed25519 verifier', () => {
  it('builds the same trust store, checking all signatures in one batch', async () => {
    const { verify, calls } = recording();
    const sync = buildTrustStore(trustInput);
    const async_ = await buildTrustStoreAsync(trustInput, verify);
    expect(async_).toEqual(sync);
    expect(calls).toHaveLength(file.trust.certificates.length + 1);
  });

  it('gives identical results on every certificate vector', async () => {
    for (const v of file.certificateVectors) {
      const input = { rootPublicKey: trustInput.rootPublicKey, certificates: [hexToBytes(v.certificate)] };
      expect(await buildTrustStoreAsync(input, recording().verify), v.name).toEqual(buildTrustStore(input));
    }
  });

  it('gives identical results on every alert vector', async () => {
    const { store } = buildTrustStore(trustInput);
    for (const v of file.alertVectors) {
      const envelope = hexToBytes(v.envelope);
      expect(await verifyAlertAsync(envelope, store, file.now, recording().verify), v.name).toEqual(
        verifyAlert(envelope, store, file.now),
      );
    }
  });

  it('defaults to the JS reference when no verifier is given', async () => {
    const { store } = buildTrustStore(trustInput);
    const v = file.alertVectors.find((x) => x.expect === 'OK')!;
    expect(await verifyAlertAsync(hexToBytes(v.envelope), store, file.now)).toMatchObject({ ok: true });
    expect(await buildTrustStoreAsync(trustInput)).toEqual(buildTrustStore(trustInput));
  });

  it('passes the domain-separated message, and treats false, throws and rejections as invalid', async () => {
    const { store } = buildTrustStore(trustInput);
    const v = file.alertVectors.find((x) => x.name === 'valid_red_nationwide')!;
    const envelope = hexToBytes(v.envelope);
    const { verify, calls } = recording();
    await verifyAlertAsync(envelope, store, file.now, verify);
    expect(new TextDecoder().decode(calls[0]!.slice(0, Context.alert.length + 1))).toBe(`${Context.alert}\0`);

    for (const bad of [
      () => false,
      () => Promise.resolve(false),
      () => {
        throw new Error('native failure');
      },
      () => Promise.reject(new Error('native failure')),
      () => 1 as unknown as boolean,
    ] satisfies Ed25519Verifier[]) {
      expect(await verifyAlertAsync(envelope, store, file.now, bad)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    }
    expect(await buildTrustStoreAsync(trustInput, () => false)).toMatchObject({
      rejected: file.trust.certificates.map((_, i) => ({ item: i, reason: 'BAD_SIGNATURE' })).concat([
        { item: 'revocation', reason: 'BAD_SIGNATURE' } as never,
      ]),
    });
  });

  it('never calls the verifier with malformed lengths', async () => {
    const { store } = buildTrustStore(trustInput);
    const v = file.alertVectors.find((x) => x.name === 'valid_red_nationwide')!;
    const store2 = { ...store, certificates: new Map([...store.certificates].map(([k, c]) => [k, { ...c, publicKey: c.publicKey.slice(1) }])) };
    let called = false;
    const r = await verifyAlertAsync(hexToBytes(v.envelope), store2, file.now, () => (called = true));
    expect(r).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(called).toBe(false);
  });

  it('verifies manifests the same way', async () => {
    const rootSk = generateSecretKey(new Uint8Array(32).fill(1));
    const contentSk = generateSecretKey(new Uint8Array(32).fill(2));
    const now = 1_800_000_000;
    const cert = createCertificate(rootSk, {
      publicKey: getPublicKey(contentSk),
      role: Role.Content,
      validFrom: now - 10,
      validTo: now + 10,
      name: 'TEST content',
    });
    const { store } = buildTrustStore({ rootPublicKey: getPublicKey(rootSk), certificates: [cert] });
    const manifest = new TextEncoder().encode('{"files":[]}');
    const sig = signManifest(contentSk, manifest);
    const { verify, calls } = recording();
    const result = await verifyManifestAsync(manifest, sig, store, now, verify);
    expect(result).toEqual(verifyManifest(manifest, sig, store, now));
    expect(result.ok).toBe(true);
    expect(calls).toEqual([contextMessage(Context.manifest, manifest)]);
    expect(await verifyManifestAsync(manifest, sig, store, now, () => false)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  appliesToArea,
  buildTrustStore,
  Category,
  createCertificate,
  createRevocationList,
  decodeAlertEnvelope,
  encodeAlertBody,
  FormatError,
  generateSecretKey,
  getPublicKey,
  Level,
  MsgType,
  NATIONWIDE,
  newAlertId,
  Role,
  signAlert,
  verifyAlert,
  withHops,
  type Alert,
} from '../src/index.js';

const NOW = 1_800_000_000;

function setup() {
  const rootSk = generateSecretKey();
  const issuerSk = generateSecretKey();
  const cert = createCertificate(rootSk, {
    publicKey: getPublicKey(issuerSk),
    role: Role.TestIssuer,
    validFrom: NOW - 1000,
    validTo: NOW + 100_000,
    areas: [NATIONWIDE],
    name: 'unit-test issuer',
  });
  const { store, rejected } = buildTrustStore({ rootPublicKey: getPublicKey(rootSk), certificates: [cert] });
  expect(rejected).toEqual([]);
  return { rootSk, issuerSk, store };
}

const alertFields = (over: Partial<Omit<Alert, 'issuerKeyId'>> = {}): Omit<Alert, 'issuerKeyId'> => ({
  id: newAlertId(),
  issued: NOW,
  expires: NOW + 3600,
  msgType: MsgType.Alert,
  level: Level.Red,
  category: Category.Air,
  template: 1,
  areas: [13, 19, 42],
  test: true,
  ...over,
});

describe('sign and verify', () => {
  it('accepts a freshly signed alert', () => {
    const { issuerSk, store } = setup();
    const env = signAlert(issuerSk, alertFields());
    const r = verifyAlert(env, store, NOW + 10);
    expect(r.ok).toBe(true);
  });

  it('keeps a template alert with three areas small enough for BLE and push', () => {
    const { issuerSk } = setup();
    const env = signAlert(issuerSk, alertFields());
    expect(env.length).toBeLessThanOrEqual(160);
  });

  it('lets relays change hops without invalidating the signature', () => {
    const { issuerSk, store } = setup();
    const env = signAlert(issuerSk, alertFields());
    const relayed = withHops(withHops(env, 1), 2);
    const r = verifyAlert(relayed, store, NOW);
    expect(r.ok && r.hops).toBe(2);
    expect(decodeAlertEnvelope(relayed).body).toEqual(decodeAlertEnvelope(env).body);
  });

  it('rejects an alert from a key signed by a different root', () => {
    const { store } = setup();
    const other = setup();
    const env = signAlert(other.issuerSk, alertFields());
    const r = verifyAlert(env, store, NOW);
    expect(r).toMatchObject({ ok: false, reason: 'UNKNOWN_ISSUER' });
  });

  it('applies a later revocation list', () => {
    const { rootSk, issuerSk, store } = setup();
    const fields = alertFields();
    const env = signAlert(issuerSk, fields);
    const revocation = createRevocationList(rootSk, { seq: 2, issued: NOW, keyIds: [], alertIds: [fields.id] });
    const revoked = buildTrustStore({
      rootPublicKey: store.rootPublicKey,
      certificates: [],
      revocation,
    });
    expect(revoked.rejected).toEqual([]);
    const withRevocation = { ...store, revokedAlertIds: revoked.store.revokedAlertIds };
    expect(verifyAlert(env, withRevocation, NOW)).toMatchObject({ ok: false, reason: 'ALERT_REVOKED' });
  });

  it('rejects a revocation list not signed by the root', () => {
    const { store } = setup();
    const rogue = createRevocationList(generateSecretKey(), { seq: 99, issued: NOW, keyIds: [], alertIds: [] });
    const r = buildTrustStore({ rootPublicKey: store.rootPublicKey, certificates: [], revocation: rogue });
    expect(r.rejected).toEqual([{ item: 'revocation', reason: 'BAD_SIGNATURE' }]);
    expect(r.store.revocation).toBeUndefined();
  });
});

describe('alert validation on encode', () => {
  const issuerKeyId = new Uint8Array(8);
  const bad: [string, Partial<Alert>][] = [
    ['short id', { id: new Uint8Array(15) }],
    ['expires before issued', { expires: NOW - 1 }],
    ['empty areas', { areas: [] }],
    ['unsorted areas', { areas: [19, 13] }],
    ['duplicate areas', { areas: [13, 13] }],
    ['nationwide mixed with areas', { areas: [0, 13] }],
    ['area out of range', { areas: [256] }],
    ['ref on plain alert', { ref: new Uint8Array(16) }],
    ['update without ref', { msgType: MsgType.Update }],
    ['missing level', { level: undefined as never }],
    ['template out of range', { template: 70_000 }],
    ['unknown language', { text: { de: 'Hallo' } as never }],
    ['empty text', { text: { lt: '' } }],
    ['text too long', { text: { lt: 'a'.repeat(769) } }],
    ['empty text map', { text: {} }],
  ];
  it.each(bad)('rejects %s', (_name, over) => {
    const a = { ...alertFields(), issuerKeyId, ...over } as Alert;
    if ('level' in over && over.level === undefined) delete a.level;
    expect(() => encodeAlertBody(a)).toThrow(FormatError);
  });

  it('rejects cancel with level', () => {
    const a = { ...alertFields({ msgType: MsgType.Cancel, ref: new Uint8Array(16) }), issuerKeyId };
    expect(() => encodeAlertBody(a)).toThrow(/cancel must not carry/);
  });
});

describe('certificates', () => {
  it('refuses to create an issuer certificate without areas', () => {
    const sk = generateSecretKey();
    expect(() =>
      createCertificate(sk, { publicKey: getPublicKey(sk), role: Role.TestIssuer, validFrom: 0, validTo: 1, name: 'x' }),
    ).toThrow(/require areas/);
  });
});

describe('appliesToArea', () => {
  const a = (areas: number[]) => ({ ...alertFields({ areas }), issuerKeyId: new Uint8Array(8) });
  it('matches nationwide alerts everywhere', () => {
    expect(appliesToArea(a([NATIONWIDE]), 42)).toBe(true);
  });
  it('matches only listed areas otherwise', () => {
    expect(appliesToArea(a([13, 19]), 19)).toBe(true);
    expect(appliesToArea(a([13, 19]), 20)).toBe(false);
  });
});

describe('relay', () => {
  it('derives the same alert ID for the same source message', async () => {
    const { relayAlertId, Source } = await import('../src/index.js');
    const a = relayAlertId(Source.PagdWarningFeed, '18210');
    expect(a).toEqual(relayAlertId(Source.PagdWarningFeed, '18210'));
    expect(a).not.toEqual(relayAlertId(Source.PagdWarningFeed, '18211'));
    expect(a.length).toBe(16);
  });

  it('marks relay-signed alerts as relayed and issuer-signed ones as not', async () => {
    const { relayAlertId, Source } = await import('../src/index.js');
    const rootSk = generateSecretKey();
    const relaySk = generateSecretKey();
    const issuerSk = generateSecretKey();
    const window = { validFrom: NOW - 1000, validTo: NOW + 100_000, areas: [NATIONWIDE] };
    const { store } = buildTrustStore({
      rootPublicKey: getPublicKey(rootSk),
      certificates: [
        createCertificate(rootSk, { publicKey: getPublicKey(relaySk), role: Role.TestRelay, ...window, name: 'relay' }),
        createCertificate(rootSk, { publicKey: getPublicKey(issuerSk), role: Role.TestIssuer, ...window, name: 'issuer' }),
      ],
    });
    const relayedFields = alertFields({
      id: relayAlertId(Source.PagdWarningFeed, 'x1'),
      source: Source.PagdWarningFeed,
      sourceRef: 'x1',
      text: { lt: 'Oro pavojus' },
    });
    delete relayedFields.template;
    const r1 = verifyAlert(signAlert(relaySk, relayedFields), store, NOW);
    const r2 = verifyAlert(signAlert(issuerSk, alertFields()), store, NOW);
    expect(r1.ok && r1.relayed).toBe(true);
    expect(r2.ok && !r2.relayed).toBe(true);
  });

  it('requires verbatim lt text on relayed alerts', async () => {
    const { Source } = await import('../src/index.js');
    const a = { ...alertFields({ source: Source.PagdWarningFeed, sourceRef: 'x', text: { en: 'Air raid' } }), issuerKeyId: new Uint8Array(8) };
    expect(() => encodeAlertBody(a)).toThrow(/verbatim source text/);
  });
});

describe('content manifests', () => {
  it('verifies a manifest signed by a content key and rejects tampering and wrong roles', async () => {
    const { signManifest, verifyManifest, encodeUtf8 } = { ...(await import('../src/index.js')), ...(await import('../src/utf8.js')) };
    const rootSk = generateSecretKey();
    const contentSk = generateSecretKey();
    const issuerSk = generateSecretKey();
    const window = { validFrom: NOW - 1000, validTo: NOW + 100_000 };
    const { store } = buildTrustStore({
      rootPublicKey: getPublicKey(rootSk),
      certificates: [
        createCertificate(rootSk, { publicKey: getPublicKey(contentSk), role: Role.Content, ...window, name: 'content' }),
        createCertificate(rootSk, { publicKey: getPublicKey(issuerSk), role: Role.TestIssuer, ...window, areas: [NATIONWIDE], name: 'issuer' }),
      ],
    });
    const manifest = encodeUtf8('{"files":[]}');
    const sig = signManifest(contentSk, manifest);
    expect(verifyManifest(manifest, sig, store, NOW).ok).toBe(true);
    expect(verifyManifest(encodeUtf8('{"files":[1]}'), sig, store, NOW)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(verifyManifest(manifest, signManifest(issuerSk, manifest), store, NOW)).toEqual({ ok: false, reason: 'ROLE_NOT_ALLOWED' });
    expect(verifyManifest(manifest, signManifest(generateSecretKey(), manifest), store, NOW)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    expect(verifyManifest(manifest, sig, store, NOW + 200_000)).toEqual({ ok: false, reason: 'KEY_NOT_VALID' });
    expect(verifyManifest(manifest, Uint8Array.of(0x80), store, NOW)).toEqual({ ok: false, reason: 'MALFORMED' });
  });
});

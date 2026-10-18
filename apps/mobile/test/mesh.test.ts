import {
  buildTrustStore,
  Category,
  createCertificate,
  decodeAlertEnvelope,
  generateSecretKey,
  getPublicKey,
  Level,
  MsgType,
  Role,
  signAlert,
  withHops,
} from '@priedanga/alert-format';
import { keyHex, meshKey } from '@priedanga/tiltas';
import { describe, expect, it } from 'vitest';
import { mergeAlerts } from '../src/alerts/alerts';
import { hexToBytes } from '../src/pack/hex';
import { buildOffers, liveMeshAlerts, processArrivals } from '../src/mesh/mesh';

const now = 1_800_000_000;
const rootSk = generateSecretKey();
const issuerSk = generateSecretKey();
const strangerSk = generateSecretKey();
const { store } = buildTrustStore({
  rootPublicKey: getPublicKey(rootSk),
  certificates: [
    createCertificate(rootSk, {
      publicKey: getPublicKey(issuerSk),
      role: Role.TestIssuer,
      validFrom: now - 86_400,
      validTo: now + 86_400,
      areas: [0],
      name: 'test issuer',
    }),
  ],
});

let n = 0;
const make = (sk = issuerSk, expiresIn = 3600, level: Level = Level.Red) =>
  signAlert(sk, {
    id: Uint8Array.from({ length: 16 }, (_, i) => (i === 15 ? ++n : 0)),
    issued: now - 60,
    expires: now + expiresIn,
    msgType: MsgType.Alert,
    level,
    category: Category.Air,
    template: 1,
    areas: [0],
    test: true,
  });
const keyOf = (env: Uint8Array) => keyHex(meshKey(decodeAlertEnvelope(env).body));

describe('Tiltas in the app', () => {
  it('shows verified arrivals and reports forged ones by mesh key', async () => {
    const good = make();
    const forged = make(strangerSk);
    const { accepted, rejectedKeys } = await processArrivals([good, forged, new Uint8Array([1, 2, 3])], store, now);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.via).toBe('mesh');
    expect(accepted[0]!.envelope).toEqual(good);
    expect(rejectedKeys).toEqual([keyOf(forged)]); // junk has no key to report
  });

  it('serves feed and mesh alerts with hops + 1, skipping expired and hop-limited ones', async () => {
    const feedEnv = make();
    const fromFeed = (await processArrivals([feedEnv], store, now)).accepted.map((a) => ({ ...a, via: 'feed' as const }));
    const atLimit = (await processArrivals([withHops(make(), 16)], store, now)).accepted;
    const meshEnv = withHops(make(issuerSk, 3600, Level.Yellow), 3);
    const fromMesh = (await processArrivals([meshEnv], store, now)).accepted;
    const old = (await processArrivals([make(issuerSk, 30)], store, now)).accepted.map((a) => ({ ...a, live: false }));

    const offers = await buildOffers(mergeAlerts([...fromFeed, ...old], [...fromMesh, ...atLimit]), store, now);
    expect(offers.map((o) => decodeAlertEnvelope(hexToBytes(o.envelope)).hops).sort()).toEqual([1, 4]);
    expect(offers.map((o) => o.priority).sort()).toEqual([2, 3]);
  });

  it('drops expired mesh alerts and duplicates', async () => {
    const env = make(issuerSk, 100);
    const [a] = (await processArrivals([env], store, now)).accepted;
    expect(liveMeshAlerts([a!, a!], now)).toHaveLength(1);
    expect(liveMeshAlerts([a!], now + 101)).toHaveLength(0);
  });
});

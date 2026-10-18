import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTrustStore, createCertificate, generateSecretKey, getPublicKey, Level, Role } from '@priedanga/alert-format';
import type { MunicipalitiesFile } from '@priedanga/content-builder/schema';
import { buildGazetteer } from '../../../packages/relay/src/areas';
import { buildFeed } from '../../../packages/relay/src/feed';
import { vilniusToUnix } from '../../../packages/relay/src/time';
import { describe, expect, it } from 'vitest';
import { currentAirAlert, isDanger, verifyFeed } from '../src/alerts/alerts';

const municipalities = (
  JSON.parse(readFileSync(join(__dirname, '../../../packs/dev/municipalities.json'), 'utf8')) as MunicipalitiesFile
).municipalities;
const code = (name: string) => municipalities.find((m) => m.name === name)!.code;
const g = buildGazetteer(municipalities);

const rootSk = generateSecretKey();
const relaySk = generateSecretKey();
const now = vilniusToUnix('2026-09-15T00:40:00');
const { store } = buildTrustStore({
  rootPublicKey: getPublicKey(rootSk),
  certificates: [
    createCertificate(rootSk, {
      publicKey: getPublicKey(relaySk),
      role: Role.LiveRelay,
      validFrom: now - 400 * 86_400,
      validTo: now + 86_400,
      areas: [0],
      name: 'test relay',
    }),
  ],
});

const rows = [
  {
    issiustu_pranesimu_id: '3',
    siunciamu_pranesimu_pradzia: '2026-09-15T00:33:16',
    pranesimo_tekstas_lt: 'Lietuvos kariuomenė praneša: ORO PAVOJAUS NĖRA (BALTA).',
    ivykio_vietoves_aprasymas_lt: 'Vilniaus m., Vilniaus r.',
  },
  {
    issiustu_pranesimu_id: '2',
    siunciamu_pranesimu_pradzia: '2026-09-15T00:21:46',
    pranesimo_tekstas_lt: 'LK / NKVC: TIKĖTINAS ORO PAVOJUS (GELTONA). Galimai fiksuotas dronas.',
    ivykio_vietoves_aprasymas_lt: 'Kauno apskritis',
  },
  {
    issiustu_pranesimu_id: '1',
    siunciamu_pranesimu_pradzia: '2026-09-10T10:00:00',
    pranesimo_tekstas_lt: 'Lietuvos kariuomenė praneša: „ORO PAVOJUS. Nedelsdami skubėkite į priedangą.',
    ivykio_vietoves_aprasymas_lt: 'Visa Lietuva',
  },
];
const { feed } = buildFeed({ rows, gazetteer: g, relaySecretKey: relaySk, now });

describe('verifyFeed', () => {
  it('verifies live items and keeps expired ones as history', async () => {
    const v = await verifyFeed(feed, store, now);
    expect(v.rejected).toBe(0);
    expect(v.alerts.map((a) => [a.alert.sourceRef, a.live, a.relayed])).toEqual([
      ['3', true, true],
      ['2', true, true],
      ['1', false, true],
    ]);
  });

  it('drops tampered and foreign items', async () => {
    const other = buildFeed({ rows, gazetteer: g, relaySecretKey: generateSecretKey(), now }).feed.items[0]!;
    const flipped = feed.items[1]!.slice(0, -4) + (feed.items[1]!.endsWith('00') ? 'ff' : '00') + feed.items[1]!.slice(-2);
    const v = await verifyFeed({ ...feed, items: [feed.items[0]!, flipped, other, 'zz'] }, store, now);
    expect(v.rejected).toBe(3);
    expect(v.alerts).toHaveLength(1);
  });

  it('rejects unknown feed formats', async () => {
    await expect(verifyFeed({ ...feed, version: 2 as 1 }, store, now)).rejects.toThrow(/format/);
  });
});

describe('currentAirAlert', () => {
  it('picks the newest live air alert covering the area', async () => {
    const { alerts } = await verifyFeed(feed, store, now);
    const kaunas = currentAirAlert(alerts, code('Kauno miesto sav.'));
    expect(kaunas?.alert.level).toBe(Level.Yellow);
    expect(isDanger(kaunas)).toBe(true);

    const vilnius = currentAirAlert(alerts, code('Vilniaus miesto sav.'));
    expect(vilnius?.alert.level).toBe(Level.White);
    expect(isDanger(vilnius)).toBe(false);

    // Expired nationwide red alert from five days ago must not count.
    expect(currentAirAlert(alerts, code('Klaipėdos miesto sav.'))).toBeNull();
  });

  it('only counts nationwide alerts when the area is unknown', async () => {
    const { alerts } = await verifyFeed(feed, store, now);
    expect(currentAirAlert(alerts, null)).toBeNull();
  });
});

import { readFileSync } from 'node:fs';
import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  buildTrustStore,
  Category,
  createCertificate,
  generateSecretKey,
  getPublicKey,
  Level,
  relayAlertId,
  Role,
  Source,
  verifyAlert,
} from '@priedanga/alert-format';
import type { MunicipalitiesFile, PlacesFile } from '@priedanga/content-builder/schema';
import { buildGazetteer, parseAreas } from '../src/areas.js';
import { classify, lifetimeSeconds } from '../src/classify.js';
import { buildFeed } from '../src/feed.js';
import { vilniusToUnix } from '../src/time.js';

const municipalities = (
  JSON.parse(readFileSync(new URL('../../../packs/dev/municipalities.json', import.meta.url), 'utf8')) as MunicipalitiesFile
).municipalities;
const places = (
  JSON.parse(readFileSync(new URL('../../../packs/dev/places.json', import.meta.url), 'utf8')) as PlacesFile
).places;
const g = buildGazetteer(municipalities, places);
const code = (name: string) => municipalities.find((m) => m.name === name)!.code;
const county = (c: string) => municipalities.filter((m) => m.county === c).map((m) => m.code).sort((a, b) => a - b);

describe('classify (official wording)', () => {
  it.each([
    ['LK / NKVC: TIKĖTINAS ORO PAVOJUS (GELTONA). Galimai fiksuotas dronas.', Level.Yellow],
    ['Lietuvos kariuomenė praneša: „ORO PAVOJUS DĖL DRONO". Nedelsdami skubėkite į priedangą', Level.Red],
    ['Lietuvos kariuomenė praneša: „ORO PAVOJUS. Nedelsdami skubėkite į priedangą', Level.Red],
    ['Lietuvos kariuomenė praneša: ORO PAVOJAUS NĖRA (BALTA). Oro pavojus atšaukiamas', Level.White],
    ['ORO PAVOJUS (GELTONA PO RAUDONOS). Likite saugioje vietoje', Level.YellowAfterRed],
  ])('%s', (text, level) => {
    const c = classify(text);
    expect(c).toMatchObject({ category: Category.Air, level, airAlert: true });
  });

  it('treats non-air messages as other, with a longer lifetime', () => {
    const c = classify('PD informuoja: dėl eismo įvykio kelyje A6 eismas laikinai sustabdytas.');
    expect(c).toMatchObject({ category: Category.Other, airAlert: false });
    expect(lifetimeSeconds(c)).toBe(86_400);
    expect(lifetimeSeconds(classify('ORO PAVOJUS'))).toBe(6 * 3600);
    expect(lifetimeSeconds(classify('ORO PAVOJAUS NĖRA'))).toBe(2 * 3600);
  });
});

describe('parseAreas (real PAGD descriptions)', () => {
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const areas = (text: string | null, hint?: string) => parseAreas(text, g, hint);

  it('maps city and district abbreviations, with and without dots', () => {
    expect(areas('Vilniaus m, Vilniaus r., Trakų r., Elektrėnų r')).toEqual({
      confidence: 'matched',
      areas: sorted([code('Vilniaus miesto sav.'), code('Vilniaus rajono sav.'), code('Trakų rajono sav.'), code('Elektrėnų sav.')]),
    });
  });

  it('expands counties in their many spellings', () => {
    expect(areas('Kauno apskritis').areas).toEqual(county('Kauno'));
    expect(areas('Vilniaus apsK').areas).toEqual(county('Vilniaus'));
    expect(areas('Alytaus apskr.').areas).toEqual(county('Alytaus'));
  });

  it('handles a shared type marker at the end of a list', () => {
    expect(areas('Visagino, Švenčionių, Zarasų ir Utenos r. sav').areas).toEqual(
      sorted([code('Visagino sav.'), code('Švenčionių rajono sav.'), code('Zarasų rajono sav.'), code('Utenos rajono sav.')]),
    );
  });

  it('reads "raj." and lists without commas', () => {
    expect(areas('Druskininkų sav. Lazdijų raj. sav. Varėnos raj. sav. ir Alytaus raj. sav.').areas).toEqual(
      sorted([code('Druskininkų sav.'), code('Lazdijų rajono sav.'), code('Varėnos rajono sav.'), code('Alytaus rajono sav.')]),
    );
  });

  it('prefers a named municipality over its county in full addresses', () => {
    expect(areas('Gudelių g. 49, Vilnius (adresas - Vilniaus m., Vilniaus m. sav., Vilniaus apskr.)').areas).toEqual([code('Vilniaus miesto sav.')]);
  });

  it('recognises plain town names and locatives', () => {
    expect(areas('Pramonės g. 1, Alytus').areas).toContain(code('Alytaus miesto sav.'));
    expect(areas('Klaipėda').areas).toContain(code('Klaipėdos miesto sav.'));
    expect(areas('A5 Vakarinis aplinkkelis, Kaune').areas).toEqual([code('Kauno miesto sav.')]);
  });

  it('does not mistake street names for municipalities', () => {
    expect(areas('Vilniaus g. 5, Kaune').areas).toEqual([code('Kauno miesto sav.')]);
  });

  it('includes both city and district when the text does not say which', () => {
    expect(areas('Vilniaus').areas).toEqual(sorted([code('Vilniaus miesto sav.'), code('Vilniaus rajono sav.')]));
  });

  it('uses the source field when the description is generic', () => {
    expect(areas('Savivaldybės teritorija', 'Raseinių r. sav.')).toEqual({ areas: [code('Raseinių rajono sav.')], confidence: 'source_hint' });
  });

  it('falls back to nationwide for "and others", empty and unknown text', () => {
    expect(areas('Vilniaus apskr., ir kt.')).toEqual({ areas: [0], confidence: 'fallback_nationwide' });
    expect(areas(null)).toEqual({ areas: [0], confidence: 'fallback_nationwide' });
    expect(areas('Eiveniu g')).toEqual({ areas: [0], confidence: 'fallback_nationwide' });
    expect(areas('Visa Lietuva')).toEqual({ areas: [0], confidence: 'nationwide' });
    expect(areas('LR')).toEqual({ areas: [0], confidence: 'nationwide' });
  });
});

describe('vilniusToUnix', () => {
  it('uses UTC+3 in summer and UTC+2 in winter', () => {
    expect(new Date(vilniusToUnix('2026-09-15T00:33:16') * 1000).toISOString()).toBe('2026-09-14T21:33:16.000Z');
    expect(new Date(vilniusToUnix('2026-01-10T12:00:00') * 1000).toISOString()).toBe('2026-01-10T10:00:00.000Z');
  });
  it('rejects garbage', () => {
    expect(() => vilniusToUnix('yesterday')).toThrow();
  });
});

describe('buildFeed', () => {
  const rootSk = generateSecretKey();
  const relaySk = generateSecretKey();
  const now = vilniusToUnix('2026-09-15T01:00:00');
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
      issiustu_pranesimu_id: '18990',
      siunciamu_pranesimu_pradzia: '2026-09-15T00:33:16',
      pranesimo_tekstas_lt: 'Lietuvos kariuomenė praneša: ORO PAVOJAUS NĖRA (BALTA).',
      ivykio_vietoves_aprasymas_lt: 'Vilniaus m., Vilniaus r., Elektrėnų r., Trakų r., Kauno apskr.',
    },
    {
      issiustu_pranesimu_id: '18989',
      siunciamu_pranesimu_pradzia: '2026-09-15T00:21:46',
      pranesimo_tekstas_lt: 'LK / NKVC: TIKĖTINAS ORO PAVOJUS (GELTONA). Galimai fiksuotas dronas.',
      ivykio_vietoves_aprasymas_lt: 'Kauno apskritis',
    },
    { issiustu_pranesimu_id: '1', siunciamu_pranesimu_pradzia: '2018-10-22T19:00:00', pranesimo_tekstas_lt: 'Senas', ivykio_vietoves_aprasymas_lt: 'Visa Lietuva' },
    { issiustu_pranesimu_id: '2', siunciamu_pranesimu_pradzia: '2026-09-14T10:00:00', pranesimo_tekstas_lt: 'x'.repeat(800), ivykio_vietoves_aprasymas_lt: null },
  ];

  it('signs recent messages as verifiable relayed alerts with verbatim text', () => {
    const { feed, stats } = buildFeed({ rows, gazetteer: g, relaySecretKey: relaySk, now });
    expect(stats).toMatchObject({ rows: 4, relayed: 2, airAlerts: 2, skipped: { text_too_long: 1 } });
    expect(feed.items).toHaveLength(2);
    const r = verifyAlert(hexToBytes(feed.items[0]!), store, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.relayed).toBe(true);
    expect(r.alert).toMatchObject({ level: Level.White, source: Source.PagdWarningFeed, sourceRef: '18990', text: { lt: rows[0]!.pranesimo_tekstas_lt } });
    expect(r.alert.id).toEqual(relayAlertId(Source.PagdWarningFeed, '18990'));
  });

  it('produces the same alert IDs on every run (redundant relays deduplicate)', () => {
    const a = buildFeed({ rows, gazetteer: g, relaySecretKey: relaySk, now }).feed.items;
    const b = buildFeed({ rows, gazetteer: g, relaySecretKey: generateSecretKey(), now }).feed.items;
    const ids = (items: string[]) => items.map((h) => h.slice(0, 120));
    expect(a).toEqual(buildFeed({ rows, gazetteer: g, relaySecretKey: relaySk, now }).feed.items);
    expect(ids(a)).not.toEqual(ids(b)); // signatures and key IDs differ...
    // ...but the alert IDs inside match
    const alertId = (h: string) => {
      const r = verifyAlert(hexToBytes(h), store, now);
      return r.ok ? Buffer.from(r.alert.id).toString('hex') : null;
    };
    expect(alertId(a[0]!)).toBe(Buffer.from(relayAlertId(Source.PagdWarningFeed, '18990')).toString('hex'));
  });
});

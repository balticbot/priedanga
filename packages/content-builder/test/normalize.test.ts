import { describe, expect, it } from 'vitest';
import { buildMunicipalityIndex, municipalityKey, normalizeAll, normalizeRow, parseMunicipalities, Stats } from '../src/normalize.js';
import { packVersion } from '../src/pack.js';

const municipalities = [
  { code: 13, name: "Vilniaus miesto sav.", county: "Vilniaus" },
  { code: 69, name: "Prienų rajono sav.", county: "Kauno" },
  { code: 12, name: "Birštono sav.", county: "Kauno" },
];
const index = buildMunicipalityIndex(municipalities);

const shelterRow = (over: Record<string, unknown> = {}) => ({
  vda_id: '00124ed3cba7325',
  gatve: 'Statybininkų',
  namo_numeris: '11',
  savivaldybe: 'Prienų r. sav.',
  gyvenviete: 'Prienai',
  pavadinimas: 'Daugiabutis gyvenamasis namas',
  valdytojas: 'UAB "Prienų butų ūkis"',
  patalpu_apsvietimas: null,
  wgs_lat_platuma: 54.6439744,
  wgs_lon_ilguma: 23.9518952,
  atnaujinimo_data: '2026-06-18',
  gyventoju_skaicius: 193,
  plotas: 290.0,
  pazenklinta: true,
  pastabos: '',
  ...over,
});

describe('municipality names', () => {
  it('maps PAGD abbreviations to Address Register names', () => {
    expect(municipalityKey('Prienų r. sav.')).toBe(municipalityKey('Prienų rajono sav.'));
    expect(municipalityKey('Vilniaus m. sav.')).toBe(municipalityKey('Vilniaus miesto sav.'));
    expect(municipalityKey('  Birštono   sav. ')).toBe('birštono sav.');
  });

  it('requires exactly 60 municipalities with byte-sized codes and a county', () => {
    const counties = [{ _id: 'c10', pavadinimas: 'Vilniaus' }];
    const row = { sav_kodas: 13, pavadinimas: 'Vilniaus miesto', tipo_santrumpa: 'sav.', apskritis: { _id: 'c10' } };
    expect(() => parseMunicipalities([row], counties)).toThrow(/60/);
    expect(() => parseMunicipalities([{ ...row, apskritis: { _id: 'nope' } }], counties)).toThrow(/unexpected/);
  });
});

describe('normalizeRow', () => {
  it('normalizes a shelter row', () => {
    const stats = new Stats();
    const p = normalizeRow('shelter', shelterRow(), index, stats);
    expect(p).toEqual({
      id: 's:00124ed3cba7325',
      k: 0,
      n: 'Daugiabutis gyvenamasis namas',
      a: 'Statybininkų 11',
      s: 'Prienai',
      m: 69,
      lat: 54.643974,
      lon: 23.951895,
      cap: 193,
      area: 290,
      acc: null,
      h24: null,
      hrs: null,
      light: null,
      san: null,
      vent: null,
      sign: true,
      op: 'UAB "Prienų butų ūkis"',
      note: null,
      et: null,
      r: null,
      upd: '2026-06-18',
    });
    expect(stats.counts).toEqual({ 'shelter.kept': 1 });
  });

  it('fixes swapped coordinates and drops points outside Lithuania', () => {
    const stats = new Stats();
    const swapped = normalizeRow('shelter', shelterRow({ wgs_lat_platuma: 23.95, wgs_lon_ilguma: 54.64 }), index, stats);
    expect(swapped).toMatchObject({ lat: 54.64, lon: 23.95 });
    expect(normalizeRow('shelter', shelterRow({ wgs_lat_platuma: 52.2, wgs_lon_ilguma: 21.0 }), index, stats)).toBeNull();
    expect(normalizeRow('shelter', shelterRow({ wgs_lat_platuma: null }), index, stats)).toBeNull();
    expect(stats.counts).toMatchObject({
      'shelter.fixed.swapped_coordinates': 1,
      'shelter.dropped.outside_lithuania': 1,
      'shelter.dropped.no_coordinates': 1,
    });
  });

  it('drops rows with unknown municipalities instead of guessing', () => {
    const stats = new Stats();
    expect(normalizeRow('shelter', shelterRow({ savivaldybe: 'Atlantidos sav.' }), index, stats)).toBeNull();
    expect(stats.counts['shelter.dropped.unknown_municipality']).toBe(1);
  });

  it('keeps siren radius and uses the mounting address when there is no street', () => {
    const p = normalizeRow(
      'siren',
      {
        vda_id: 'x1',
        savivaldybe: 'Birštono sav.',
        sirenos_sumontavimo_adresas: 'Kęstučio g. 29, Birštonas',
        garso_spindulys: 750.0,
        wgs_lat_platuma: 54.6,
        wgs_lon_ilguma: 24.02,
      },
      index,
      new Stats(),
    );
    expect(p).toMatchObject({ id: 'r:x1', k: 3, a: 'Kęstučio g. 29, Birštonas', r: 750 });
  });

  it('removes duplicate register IDs', () => {
    const stats = new Stats();
    const out = normalizeAll('shelter', [shelterRow(), shelterRow()], index, stats);
    expect(out).toHaveLength(1);
    expect(stats.counts).toMatchObject({ 'shelter.kept': 1, 'shelter.dropped.duplicate_id': 1 });
  });
});

describe('packVersion', () => {
  it('is UTC yyyymmddHHMM', () => {
    expect(packVersion(new Date('2026-10-18T07:04:59Z'))).toBe(202610180704);
  });
});

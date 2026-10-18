import { describe, expect, it } from 'vitest';
import { bearingDeg, compassIndex, distanceM, formatDistance, inLithuania, nearest, sirenCoverage } from '../src/geo';
import type { PackPlace } from '@priedanga/content-builder/schema';

const vilnius = { lat: 54.6872, lon: 25.2797 };
const kaunas = { lat: 54.8985, lon: 23.9036 };

const place = (id: string, k: 0 | 1 | 2 | 3, lat: number, lon: number, r: number | null = null): PackPlace => ({
  id, k, n: id, a: null, s: null, m: 13, lat, lon, cap: null, area: null, acc: null, h24: null, hrs: null,
  light: null, san: null, vent: null, sign: null, op: null, note: null, et: null, r, upd: null,
});

describe('geo', () => {
  it('measures Vilnius–Kaunas centres at about 91 km', () => {
    expect(distanceM(vilnius, kaunas) / 1000).toBeCloseTo(91.3, 0);
  });

  it('gives Kaunas as west-north-west of Vilnius', () => {
    const b = bearingDeg(vilnius, kaunas);
    expect(b).toBeGreaterThan(280);
    expect(b).toBeLessThan(295);
    expect(compassIndex(b)).toBe(6); // W
    expect(compassIndex(359)).toBe(0);
  });

  it('sorts nearest and applies the filter', () => {
    const places = [place('far', 0, 54.9, 25.3), place('near', 0, 54.688, 25.28), place('siren', 3, 54.6873, 25.2797)];
    const r = nearest(places, vilnius, 5, (p) => p.k === 0);
    expect(r.map((n) => n.place.id)).toEqual(['near', 'far']);
  });

  it('detects siren coverage from the published radius', () => {
    const s = place('siren', 3, 54.69, 25.28, 500);
    expect(sirenCoverage([s], vilnius).covered).toBe(true);
    expect(sirenCoverage([{ ...s, r: 100 }], vilnius).covered).toBe(false);
    expect(sirenCoverage([], vilnius).nearest).toBeNull();
  });

  it('formats distances and checks the Lithuania box', () => {
    expect(formatDistance(234)).toBe('230 m');
    expect(formatDistance(1530)).toBe('1.5 km');
    expect(formatDistance(23_400)).toBe('23 km');
    expect(inLithuania(vilnius)).toBe(true);
    expect(inLithuania({ lat: 52.23, lon: 21.01 })).toBe(false);
  });
});

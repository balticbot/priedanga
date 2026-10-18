import { NATIONWIDE } from '@priedanga/alert-format';
import type { Municipality, PackPlace } from '@priedanga/content-builder/schema';

/**
 * - matched:              areas found in the description
 * - source_hint:          description gave nothing; areas taken from the message's source field
 * - nationwide:           the description says the whole country
 * - fallback_nationwide:  not understood (or "and others"), so everyone is alerted
 */
export type AreaConfidence = 'matched' | 'source_hint' | 'nationwide' | 'fallback_nationwide';

export interface AreaResult {
  areas: number[];
  confidence: AreaConfidence;
}

interface Muni {
  code: number;
  county: string;
  stem: string;
  isCity: boolean;
  isDistrict: boolean;
}

export interface Gazetteer {
  municipalities: Muni[];
  /** Lowercase settlement name (nominative) -> municipality codes. */
  settlements: Map<string, number[]>;
  counties: Set<string>;
}

/** Locative forms used in messages ("Kaune") for the largest cities. */
const LOCATIVES: Record<string, string> = {
  vilniuje: 'Vilniaus miesto sav.',
  kaune: 'Kauno miesto sav.',
  klaipėdoje: 'Klaipėdos miesto sav.',
  šiauliuose: 'Šiaulių miesto sav.',
  panevėžyje: 'Panevėžio miesto sav.',
  alytuje: 'Alytaus miesto sav.',
};

const lc = (s: string) => s.toLocaleLowerCase('lt');

/**
 * Build the place-name index from the official municipality list and the
 * settlement names in the shelter registers (towns that appear in at least
 * `minPlaces` register entries, so tiny villages with common-word names are
 * left out).
 */
export function buildGazetteer(
  municipalities: readonly Municipality[],
  places: readonly Pick<PackPlace, 's' | 'm'>[] = [],
  minPlaces = 3,
): Gazetteer {
  const munis: Muni[] = municipalities.map((m) => {
    const name = lc(m.name);
    return { code: m.code, county: lc(m.county), stem: name.split(' ')[0]!, isCity: name.includes('miesto'), isDistrict: name.includes('rajono') };
  });

  const counts = new Map<string, Map<number, number>>();
  for (const p of places) {
    if (!p.s) continue;
    const name = lc(p.s).trim();
    if (name.length < 4 || /sav\.?$|\bm\.$|\bsav\b/.test(name)) continue;
    const byMuni = counts.get(name) ?? new Map<number, number>();
    byMuni.set(p.m, (byMuni.get(p.m) ?? 0) + 1);
    counts.set(name, byMuni);
  }
  const settlements = new Map<string, number[]>();
  for (const [name, byMuni] of counts) {
    const total = [...byMuni.values()].reduce((a, b) => a + b, 0);
    if (total >= minPlaces && byMuni.size <= 2) settlements.set(name, [...byMuni.keys()]);
  }
  for (const [loc, munName] of Object.entries(LOCATIVES)) {
    const m = municipalities.find((x) => x.name === munName);
    if (m) settlements.set(loc, [m.code]);
  }

  return { municipalities: munis, settlements, counties: new Set(munis.map((m) => m.county)) };
}

const WORDS = /[a-ząčęėįšųūž]+/g;
const STREET_AFTER = /^\s*(g\.|g\b|gatv|pr\.|prosp|al\.|alėj|pl\.|plent|skg|skv)/;
const COUNTY_AFTER = /^\s*apsk/;
const CITY_AFTER = /^\s*(m\b|m\.|miest)/;
const DISTRICT_AFTER = /^\s*(r\b|r\.|raj|rajon)/;

function scan(text: string, g: Gazetteer): number[] {
  const muniHits = new Set<number>();
  const countyHits = new Set<string>();
  const words = [...text.matchAll(WORDS)];

  for (let i = 0; i < words.length; i++) {
    const w = words[i]![0];
    const end = words[i]!.index! + w.length;
    const after = text.slice(end, end + 16);
    if (STREET_AFTER.test(after)) continue; // "Vilniaus g. 5" is a street, not Vilnius

    if (COUNTY_AFTER.test(after) && g.counties.has(w)) {
      countyHits.add(w);
      continue;
    }

    let candidates = g.municipalities.filter((m) => m.stem === w);
    if (candidates.length > 0) {
      if (CITY_AFTER.test(after)) {
        const c = candidates.filter((m) => m.isCity);
        if (c.length > 0) candidates = c;
      } else if (DISTRICT_AFTER.test(after)) {
        const d = candidates.filter((m) => m.isDistrict);
        if (d.length > 0) candidates = d;
      }
      candidates.forEach((m) => muniHits.add(m.code));
      continue;
    }

    const next = words[i + 1]?.[0];
    const two = next ? g.settlements.get(`${w} ${next}`) : undefined;
    const one = g.settlements.get(w);
    (two ?? one)?.forEach((c) => muniHits.add(c));
  }

  // A county is context when a municipality inside it is named ("…, Vilniaus m. sav., Vilniaus apskr.").
  const codes = new Set(muniHits);
  for (const county of countyHits) {
    const inCounty = g.municipalities.filter((m) => m.county === county);
    if (!inCounty.some((m) => muniHits.has(m.code))) inCounty.forEach((m) => codes.add(m.code));
  }
  return [...codes].sort((a, b) => a - b);
}

/**
 * Map PAGD's free-text area description to official municipality codes.
 * When in doubt, include MORE areas: missing someone in an alert is worse
 * than alerting a neighbour. Anything not understood falls back to nationwide.
 */
export function parseAreas(description: string | null | undefined, g: Gazetteer, sourceHint?: string | null): AreaResult {
  const s = lc(description ?? '').trim();
  const nationwide = (confidence: AreaConfidence): AreaResult => ({ areas: [NATIONWIDE], confidence });

  if (/vis(a|oje|ai) lietuv|lietuvos respublik|^(lr|lt|lietuva)$/.test(s)) return nationwide('nationwide');
  // "ir kt." / "ir kiti" = "and others": the listed areas are not complete.
  if (/\bir kt\b|\bir kit(i|os|ų)\b/.test(s)) return nationwide('fallback_nationwide');

  const found = scan(s, g);
  if (found.length > 0) return { areas: found, confidence: 'matched' };

  const hint = sourceHint ? scan(lc(sourceHint), g) : [];
  if (hint.length > 0) return { areas: hint, confidence: 'source_hint' };

  return nationwide('fallback_nationwide');
}

import type { Row } from './fetch.js';
import { PlaceKindIndex, type Municipality, type PackPlace, type PlaceKind } from './schema.js';

/** Rough bounding box of Lithuania, with a small margin. */
export const LT_BBOX = { minLat: 53.85, maxLat: 56.5, minLon: 20.9, maxLon: 26.9 } as const;

const ID_PREFIX: Record<PlaceKind, string> = { shelter: 's', kas: 'k', evacuation: 'e', siren: 'r' };

export class Stats {
  readonly counts: Record<string, number> = {};
  add(key: string, n = 1): void {
    this.counts[key] = (this.counts[key] ?? 0) + n;
  }
}

/** "Prienų r. sav." -> "prienų rajono sav."; "Vilniaus m. sav." -> "vilniaus miesto sav." */
export function municipalityKey(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/ r\. sav\.$/, ' rajono sav.')
    .replace(/ m\. sav\.$/, ' miesto sav.')
    .toLocaleLowerCase('lt');
}

export function buildMunicipalityIndex(municipalities: readonly Municipality[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const m of municipalities) index.set(municipalityKey(m.name), m.code);
  return index;
}

export function parseMunicipalities(rows: readonly Row[], countyRows: readonly Row[]): Municipality[] {
  const counties = new Map<string, string>();
  for (const c of countyRows) {
    if (typeof c['_id'] === 'string' && typeof c['pavadinimas'] === 'string') counties.set(c['_id'], c['pavadinimas']);
  }
  const out = rows.map((r) => {
    const code = r['sav_kodas'];
    const name = r['pavadinimas'];
    const suffix = r['tipo_santrumpa'];
    const countyId = (r['apskritis'] as { _id?: unknown } | undefined)?._id;
    const county = typeof countyId === 'string' ? counties.get(countyId) : undefined;
    if (typeof code !== 'number' || typeof name !== 'string' || typeof suffix !== 'string' || county === undefined) {
      throw new Error(`unexpected municipality row: ${JSON.stringify(r)}`);
    }
    if (code < 1 || code > 255) throw new Error(`municipality code out of area-code range: ${code}`);
    return { code, name: `${name} ${suffix}`, county };
  });
  if (out.length !== 60) throw new Error(`expected 60 municipalities, got ${out.length}`);
  return out.sort((a, b) => a.code - b.code);
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t === '' || t === 'None' ? null : t;
};
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const posNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const date = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function inLithuania(lat: number, lon: number): boolean {
  return lat >= LT_BBOX.minLat && lat <= LT_BBOX.maxLat && lon >= LT_BBOX.minLon && lon <= LT_BBOX.maxLon;
}

/**
 * Normalize one register row. Returns null (and records why in `stats`) if
 * the row cannot be placed on the map reliably.
 */
export function normalizeRow(
  kind: PlaceKind,
  row: Row,
  municipalities: ReadonlyMap<string, number>,
  stats: Stats,
): PackPlace | null {
  const id = str(row['vda_id']);
  if (id === null) {
    stats.add(`${kind}.dropped.no_id`);
    return null;
  }

  const rawLat = row['wgs_lat_platuma'];
  const rawLon = row['wgs_lon_ilguma'];
  if (typeof rawLat !== 'number' || typeof rawLon !== 'number') {
    stats.add(`${kind}.dropped.no_coordinates`);
    return null;
  }
  let lat: number = rawLat;
  let lon: number = rawLon;
  if (!inLithuania(lat, lon) && inLithuania(lon, lat)) {
    [lat, lon] = [lon, lat];
    stats.add(`${kind}.fixed.swapped_coordinates`);
  }
  if (!inLithuania(lat, lon)) {
    stats.add(`${kind}.dropped.outside_lithuania`);
    return null;
  }

  const munName = str(row['savivaldybe']);
  const m = munName === null ? undefined : municipalities.get(municipalityKey(munName));
  if (m === undefined) {
    stats.add(`${kind}.dropped.unknown_municipality`);
    return null;
  }

  const street = str(row['gatve']);
  const house = str(row['namo_numeris']);
  const address = [street, house].filter((x) => x !== null).join(' ') || str(row['sirenos_sumontavimo_adresas']);

  const place: PackPlace = {
    id: `${ID_PREFIX[kind]}:${id}`,
    k: PlaceKindIndex[kind],
    n: str(row['pavadinimas']),
    a: address,
    s: str(row['gyvenviete']),
    m,
    lat: round6(lat),
    lon: round6(lon),
    cap: posNum(row['gyventoju_skaicius']),
    area: posNum(row['plotas']),
    acc: bool(row['pritaikyta_asmenims_su_negalia']),
    h24: bool(row['patekimas_visa_para']),
    hrs: str(row['darbo_valandos']),
    light: bool(row['patalpu_apsvietimas']),
    san: bool(row['patalpu_sanitariniai_mazgai']),
    vent: bool(row['patalpu_ventiliacija']),
    sign: bool(row['pazenklinta']),
    op: str(row['valdytojas']) ?? str(row['savininkas']),
    note: str(row['pastabos']),
    et: str(row['evakavimo_punkto_tipas']),
    r: posNum(row['garso_spindulys']),
    upd: date(row['atnaujinimo_data']),
  };
  stats.add(`${kind}.kept`);
  return place;
}

export function normalizeAll(
  kind: PlaceKind,
  rows: readonly Row[],
  municipalities: ReadonlyMap<string, number>,
  stats: Stats,
): PackPlace[] {
  const seen = new Set<string>();
  const out: PackPlace[] = [];
  for (const row of rows) {
    const p = normalizeRow(kind, row, municipalities, stats);
    if (p === null) continue;
    if (seen.has(p.id)) {
      stats.add(`${kind}.dropped.duplicate_id`);
      stats.add(`${kind}.kept`, -1);
      continue;
    }
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

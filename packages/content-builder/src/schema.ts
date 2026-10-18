/**
 * Content-pack file formats. Shared by the builder and the app.
 * This module must stay free of Node.js imports.
 */

export const PACK_FORMAT = 'priedanga-content-pack';
export const PACK_FORMAT_VERSION = 1;

/** Place kinds, in the order used by `PackPlace.k`. */
export const PLACE_KINDS = ['shelter', 'kas', 'evacuation', 'siren'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const PlaceKindIndex = { shelter: 0, kas: 1, evacuation: 2, siren: 3 } as const;

/**
 * One place in `places.json`. Short keys keep the file small (~12k rows).
 * `null` means "the official register does not say" — never "no".
 */
export interface PackPlace {
  /** Stable ID: kind prefix + register ID, e.g. "s:00124ed3cba7325". */
  id: string;
  /** Index into PLACE_KINDS. */
  k: 0 | 1 | 2 | 3;
  /** Name / building description. */
  n: string | null;
  /** Street address, e.g. "Statybininkų 11". */
  a: string | null;
  /** Settlement (gyvenvietė). */
  s: string | null;
  /** Official municipality code (11–94, Address Register). */
  m: number;
  /** WGS84 latitude / longitude, 6 decimals. */
  lat: number;
  lon: number;
  /** Capacity in people. */
  cap: number | null;
  /** Floor area, m². */
  area: number | null;
  /** Adapted for people with disabilities. */
  acc: boolean | null;
  /** Accessible 24/7. */
  h24: boolean | null;
  /** Opening hours (free text). */
  hrs: string | null;
  /** Lighting / sanitation / ventilation available. */
  light: boolean | null;
  san: boolean | null;
  vent: boolean | null;
  /** Marked with a sign. */
  sign: boolean | null;
  /** Operator / manager. */
  op: string | null;
  /** Notes from the register. */
  note: string | null;
  /** Evacuation point type (evacuation only). */
  et: string | null;
  /** Siren audible radius in metres (sirens only). */
  r: number | null;
  /** Date the register entry was last updated (YYYY-MM-DD). */
  upd: string | null;
}

export interface PlacesFile {
  format: typeof PACK_FORMAT;
  version: typeof PACK_FORMAT_VERSION;
  places: PackPlace[];
}

export interface Municipality {
  /** Official code from the Address Register (savivaldybės kodas). */
  code: number;
  /** Official name, e.g. "Vilniaus miesto sav.". */
  name: string;
  /** County (apskritis) name in genitive, e.g. "Vilniaus". */
  county: string;
}

export interface MunicipalitiesFile {
  format: typeof PACK_FORMAT;
  version: typeof PACK_FORMAT_VERSION;
  municipalities: Municipality[];
}

export interface PackSource {
  id: string;
  url: string;
  license: string;
  attribution: string;
  rows: number;
  fetched: string;
}

export interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  format: typeof PACK_FORMAT;
  version: typeof PACK_FORMAT_VERSION;
  /** Monotonic pack version: UTC yyyymmddHHMM. Apps never downgrade. */
  packVersion: number;
  created: string;
  files: ManifestFile[];
  sources: PackSource[];
  stats: Record<string, number>;
}

/** Pack files that carry trust material rather than content (not listed in the manifest). */
export const TRUST_FILE = 'trust.json';

export interface TrustFile {
  /** Root-signed certificates (hex). The root key itself is pinned in the app, not here. */
  certificates: string[];
  revocation?: string;
}

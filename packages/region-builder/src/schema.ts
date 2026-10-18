/**
 * Region pack formats, shared by the builder and the app. No Node.js imports.
 *
 * A region pack = map tiles for one area (PMTiles) + its walking network,
 * listed with SHA-256 hashes in a manifest signed by a content key (same
 * signature format as the content pack).
 */

export const REGION_FORMAT = 'priedanga-region-pack';
export const REGION_VERSION = 1;

export interface RegionBbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface RegionManifest {
  format: typeof REGION_FORMAT;
  version: typeof REGION_VERSION;
  id: string;
  name: string;
  bbox: RegionBbox;
  created: string;
  files: { path: string; bytes: number; sha256: string }[];
  sources: { id: string; url: string; license: string; attribution: string; fetched: string }[];
  stats: Record<string, number>;
}

/**
 * Walking network. Node coordinates are integer microdegrees, flattened:
 * nodes = [lat0, lon0, lat1, lon1, ...]; edges = [a0, b0, a1, b1, ...]
 * (undirected, indices into the node list). Lengths are computed on load.
 */
export interface WalkGraphFile {
  format: 'priedanga-walk-graph';
  version: 1;
  nodes: number[];
  edges: number[];
}

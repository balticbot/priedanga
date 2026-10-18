/**
 * Build the walking network for a region from OpenStreetMap ways.
 *
 * Development source: the Overpass API for the region's bounding box. A
 * production pipeline would read a Geofabrik extract instead; the graph
 * format stays the same.
 */

import type { RegionBbox, WalkGraphFile } from './schema.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Ways people may walk on. Motorways and trunk roads are excluded (pedestrians are banned there). */
const WALKABLE =
  'footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|cycleway|corridor|crossing|road';

export function overpassQuery(b: RegionBbox): string {
  const box = `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
  return `[out:json][timeout:180];way["highway"~"^(${WALKABLE})$"]["foot"!~"^(no|private)$"]["access"!~"^(no|private)$"](${box});(._;>;);out skel qt;`;
}

interface OsmElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
}

/** Turn Overpass JSON into a compact graph, keeping only nodes used by walkable ways. */
export function buildWalkGraph(elements: readonly OsmElement[]): WalkGraphFile & { stats: Record<string, number> } {
  const coords = new Map<number, [number, number]>();
  for (const e of elements) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) coords.set(e.id, [e.lat, e.lon]);
  }
  const index = new Map<number, number>();
  const nodes: number[] = [];
  const edges: number[] = [];
  const seen = new Set<string>();
  const idx = (osmId: number): number | undefined => {
    let i = index.get(osmId);
    if (i !== undefined) return i;
    const c = coords.get(osmId);
    if (!c) return undefined;
    i = nodes.length / 2;
    index.set(osmId, i);
    nodes.push(Math.round(c[0] * 1e6), Math.round(c[1] * 1e6));
    return i;
  };
  let ways = 0;
  for (const e of elements) {
    if (e.type !== 'way' || !e.nodes) continue;
    ways++;
    for (let k = 1; k < e.nodes.length; k++) {
      const a = idx(e.nodes[k - 1]!);
      const b = idx(e.nodes[k]!);
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }
  return {
    format: 'priedanga-walk-graph',
    version: 1,
    nodes,
    edges,
    stats: { ways, nodes: nodes.length / 2, edges: edges.length / 2 },
  };
}

export async function fetchWalkGraph(bbox: RegionBbox): Promise<WalkGraphFile & { stats: Record<string, number> }> {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'priedanga-region-builder' },
    body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
  });
  if (!res.ok) throw new Error(`Overpass: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { elements: OsmElement[] };
  return buildWalkGraph(json.elements);
}

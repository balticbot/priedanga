/**
 * Offline walking routes: A* over the region's walking graph.
 * Pure TypeScript with no Node.js imports, so the app runs the same code.
 */

import type { WalkGraphFile } from './schema.js';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface WalkGraph {
  lat: Float64Array;
  lon: Float64Array;
  /** CSR adjacency: neighbours of node i are adj[start[i] .. start[i+1]). */
  start: Uint32Array;
  adj: Uint32Array;
  len: Float32Array;
  /** Coarse grid index for nearest-node lookup. */
  cells: Map<string, number[]>;
}

const R = 6_371_000;
const CELL = 0.002; // ~200 m
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

export function loadWalkGraph(file: WalkGraphFile): WalkGraph {
  if (file.format !== 'priedanga-walk-graph' || file.version !== 1) throw new Error('unsupported walk graph');
  const n = file.nodes.length / 2;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const cells = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    lat[i] = file.nodes[2 * i]! / 1e6;
    lon[i] = file.nodes[2 * i + 1]! / 1e6;
    const k = cellKey(lat[i]!, lon[i]!);
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  }
  const degree = new Uint32Array(n);
  const m = file.edges.length / 2;
  for (let e = 0; e < m; e++) {
    degree[file.edges[2 * e]!]!++;
    degree[file.edges[2 * e + 1]!]!++;
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i]! + degree[i]!;
  const fill = start.slice(0, n);
  const adj = new Uint32Array(2 * m);
  const len = new Float32Array(2 * m);
  for (let e = 0; e < m; e++) {
    const a = file.edges[2 * e]!;
    const b = file.edges[2 * e + 1]!;
    const d = distanceM(lat[a]!, lon[a]!, lat[b]!, lon[b]!);
    adj[fill[a]!] = b;
    len[fill[a]!++] = d;
    adj[fill[b]!] = a;
    len[fill[b]!++] = d;
  }
  return { lat, lon, start, adj, len, cells };
}

/** Nearest graph node within maxM metres (searches the surrounding grid cells). */
export function nearestNode(g: WalkGraph, p: LatLon, maxM = 600): number | null {
  const ci = Math.floor(p.lat / CELL);
  const cj = Math.floor(p.lon / CELL);
  const reach = Math.ceil(maxM / 111_000 / CELL) + 1;
  let best: number | null = null;
  let bestD = maxM;
  for (let di = -reach; di <= reach; di++) {
    for (let dj = -reach; dj <= reach; dj++) {
      for (const i of g.cells.get(`${ci + di}:${cj + dj}`) ?? []) {
        if (g.start[i + 1] === g.start[i]) continue; // isolated
        const d = distanceM(p.lat, p.lon, g.lat[i]!, g.lon[i]!);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best;
}

/** Binary min-heap keyed by f-score. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < this.ids.length && this.keys[l]! < this.keys[s]!) s = l;
        if (r < this.ids.length && this.keys[r]! < this.keys[s]!) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

/** Shortest path between two nodes (A* with straight-line heuristic). */
export function shortestPath(g: WalkGraph, from: number, to: number): { path: number[]; meters: number } | null {
  const n = g.lat.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (i: number) => distanceM(g.lat[i]!, g.lon[i]!, g.lat[to]!, g.lon[to]!);
  const open = new Heap();
  gScore[from] = 0;
  open.push(from, h(from));
  while (open.size > 0) {
    const u = open.pop();
    if (closed[u]) continue;
    if (u === to) break;
    closed[u] = 1;
    for (let k = g.start[u]!; k < g.start[u + 1]!; k++) {
      const v = g.adj[k]!;
      if (closed[v]) continue;
      const cand = gScore[u]! + g.len[k]!;
      if (cand < gScore[v]!) {
        gScore[v] = cand;
        prev[v] = u;
        open.push(v, cand + h(v));
      }
    }
  }
  if (!Number.isFinite(gScore[to]!)) return null;
  const path: number[] = [];
  for (let v = to; v !== -1; v = prev[v]!) path.push(v);
  path.reverse();
  return { path, meters: gScore[to]! };
}

export interface WalkRoute {
  /** [lon, lat] pairs, ready for GeoJSON. */
  coordinates: [number, number][];
  meters: number;
  /** At ~4.5 km/h. */
  minutes: number;
  /** False when no network path was found and the route is a straight line. */
  onNetwork: boolean;
}

const WALK_M_PER_MIN = 75;

/** Walking route between two points, snapping both ends to the network. */
export function walkRoute(g: WalkGraph, from: LatLon, to: LatLon): WalkRoute {
  const straight = (): WalkRoute => {
    const m = distanceM(from.lat, from.lon, to.lat, to.lon);
    return { coordinates: [[from.lon, from.lat], [to.lon, to.lat]], meters: m, minutes: Math.ceil(m / WALK_M_PER_MIN), onNetwork: false };
  };
  const a = nearestNode(g, from);
  const b = nearestNode(g, to);
  if (a === null || b === null) return straight();
  const sp = shortestPath(g, a, b);
  if (!sp) return straight();
  const head = distanceM(from.lat, from.lon, g.lat[a]!, g.lon[a]!);
  const tail = distanceM(g.lat[b]!, g.lon[b]!, to.lat, to.lon);
  const coordinates: [number, number][] = [[from.lon, from.lat], ...sp.path.map((i) => [g.lon[i]!, g.lat[i]!] as [number, number]), [to.lon, to.lat]];
  const meters = head + sp.meters + tail;
  return { coordinates, meters, minutes: Math.ceil(meters / WALK_M_PER_MIN), onNetwork: true };
}

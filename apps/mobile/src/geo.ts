import type { PackPlace } from '@priedanga/content-builder/schema';

export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0–360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Index 0..7 for N, NE, E, SE, S, SW, W, NW. */
export function compassIndex(bearing: number): number {
  return Math.round(bearing / 45) % 8;
}

export interface Nearby {
  place: PackPlace;
  distance: number;
  bearing: number;
}

/** Nearest places matching `filter`. Brute force: ~12k points takes a few ms. */
export function nearest(places: readonly PackPlace[], from: LatLon, limit: number, filter: (p: PackPlace) => boolean): Nearby[] {
  const out: Nearby[] = [];
  for (const place of places) {
    if (!filter(place)) continue;
    out.push({ place, distance: distanceM(from, place), bearing: 0 });
  }
  out.sort((a, b) => a.distance - b.distance);
  const top = out.slice(0, limit);
  for (const n of top) n.bearing = bearingDeg(from, n.place);
  return top;
}

/** Average position of a municipality's places: a coarse fallback when GPS is unavailable. */
export function municipalityCentre(places: readonly PackPlace[], code: number): LatLon | null {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const p of places) {
    if (p.m !== code) continue;
    lat += p.lat;
    lon += p.lon;
    n++;
  }
  return n === 0 ? null : { lat: lat / n, lon: lon / n };
}

/** Rough check that a position fix is inside Lithuania (spoofed or wrong fixes are common near borders). */
export function inLithuania(p: LatLon): boolean {
  return p.lat >= 53.85 && p.lat <= 56.5 && p.lon >= 20.9 && p.lon <= 26.9;
}

export interface SirenCoverage {
  covered: boolean;
  nearest: Nearby | null;
}

/** Is the position inside the published audible radius of any siren? */
export function sirenCoverage(places: readonly PackPlace[], from: LatLon): SirenCoverage {
  let best: Nearby | null = null;
  let covered = false;
  for (const p of places) {
    if (p.k !== 3) continue;
    const d = distanceM(from, p);
    if (p.r !== null && d <= p.r) covered = true;
    if (best === null || d < best.distance) best = { place: p, distance: d, bearing: 0 };
  }
  if (best) best.bearing = bearingDeg(from, best.place);
  return { covered, nearest: best };
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

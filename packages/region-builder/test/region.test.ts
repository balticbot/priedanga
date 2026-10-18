import { gunzipSync, gzipSync } from 'node:zlib';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { writePmtiles } from '../src/pmtilesWriter.js';
import { loadWalkGraph, nearestNode, shortestPath, walkRoute } from '../src/route.js';
import { latToY, lonToX, tilesForBbox } from '../src/tiles.js';
import { buildWalkGraph } from '../src/walk.js';

class BufferSource implements Source {
  constructor(private readonly buf: Uint8Array) {}
  getKey() {
    return 'mem';
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const slice = this.buf.slice(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer };
  }
}

describe('PMTiles writer', () => {
  it('produces an archive the official reader can read back, with deduplicated contents', async () => {
    const tile = (s: string) => new Uint8Array(gzipSync(Buffer.from(s)));
    const same = tile('same');
    const tiles = [
      { z: 0, x: 0, y: 0, data: tile('world') },
      { z: 14, x: 9277, y: 5155, data: same },
      { z: 14, x: 9278, y: 5155, data: same },
      { z: 15, x: 18555, y: 10310, data: tile('detail') },
    ];
    const bytes = writePmtiles(tiles, {
      tileCompression: 2,
      tileType: 1,
      minZoom: 0,
      maxZoom: 15,
      bounds: { minLon: 23.78, minLat: 54.83, maxLon: 24.07, maxLat: 54.97 },
      center: { lon: 23.9, lat: 54.9, zoom: 12 },
      metadata: { name: 'test', vector_layers: [] },
    });
    const p = new PMTiles(new BufferSource(bytes));
    const h = await p.getHeader();
    expect(h).toMatchObject({ specVersion: 3, minZoom: 0, maxZoom: 15, numAddressedTiles: 4, numTileContents: 3, tileCompression: 2, tileType: 1 });
    expect(h.minLon).toBeCloseTo(23.78, 5);
    for (const t of tiles) {
      const got = await p.getZxy(t.z, t.x, t.y);
      // the reader returns decompressed tiles
      expect(new Uint8Array(got!.data)).toEqual(new Uint8Array(gunzipSync(t.data)));
    }
    expect(await p.getZxy(14, 1, 1)).toBeUndefined();
    expect(((await p.getMetadata()) as { name: string }).name).toBe('test');
  });
});

describe('tile ranges', () => {
  it('covers a bbox at each zoom', () => {
    const bbox = { minLon: 23.78, minLat: 54.83, maxLon: 24.07, maxLat: 54.97 };
    const t = tilesForBbox(bbox, 0, 2);
    expect(t.filter((x) => x.z === 0)).toEqual([{ z: 0, x: 0, y: 0 }]);
    expect(lonToX(23.9, 15)).toBeGreaterThan(lonToX(23.78, 15));
    expect(latToY(54.83, 15)).toBeGreaterThan(latToY(54.97, 15));
  });
});

// A 3x3 grid of streets, ~111 m apart, with one missing link to force a detour.
//   6 - 7 - 8
//   |   |   |
//   3   4 - 5      (3-4 missing)
//   |   |   |
//   0 - 1 - 2
function gridElements() {
  const nodes = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) nodes.push({ type: 'node' as const, id: 100 + r * 3 + c, lat: 54.9 + r * 0.001, lon: 23.9 + c * 0.00172 });
  const way = (id: number, ns: number[]) => ({ type: 'way' as const, id, nodes: ns.map((n) => 100 + n) });
  return [...nodes, way(1, [0, 1, 2]), way(2, [6, 7, 8]), way(3, [0, 3, 6]), way(4, [1, 4, 7]), way(5, [2, 5, 8]), way(6, [4, 5])];
}

describe('walking graph and routes', () => {
  const file = buildWalkGraph(gridElements());
  const g = loadWalkGraph(file);

  it('builds a compact deduplicated graph', () => {
    expect(file.stats).toEqual({ ways: 6, nodes: 9, edges: 11 });
    expect(file.nodes[0]).toBe(54_900_000);
  });

  it('finds the shortest path around the missing link', () => {
    const sp = shortestPath(g, nearestNode(g, { lat: 54.901, lon: 23.9 })!, nearestNode(g, { lat: 54.901, lon: 23.90172 })!);
    expect(sp).not.toBeNull();
    // 3 -> 0 -> 1 -> 4 or 3 -> 6 -> 7 -> 4: three blocks instead of one
    expect(sp!.path).toHaveLength(4);
    expect(sp!.meters).toBeGreaterThan(300);
    expect(sp!.meters).toBeLessThan(360);
  });

  it('builds a walking route with snapping, distance and time', () => {
    const r = walkRoute(g, { lat: 54.9, lon: 23.9 }, { lat: 54.902, lon: 23.90344 });
    expect(r.onNetwork).toBe(true);
    expect(r.coordinates[0]).toEqual([23.9, 54.9]);
    expect(r.meters).toBeGreaterThan(400);
    expect(r.minutes).toBeGreaterThan(0);
  });

  it('falls back to a straight line far from the network', () => {
    const r = walkRoute(g, { lat: 55.5, lon: 24.5 }, { lat: 54.9, lon: 23.9 });
    expect(r.onNetwork).toBe(false);
    expect(r.coordinates).toHaveLength(2);
  });
});

export const REGION_FILES = ['manifest.json', 'manifest.sig', 'tiles.pmtiles', 'walk.json'] as const;
export type RegionFile = (typeof REGION_FILES)[number];
export type RegionAssets = Record<RegionFile, number>;

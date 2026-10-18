import type { MapProps } from '@maplibre/maplibre-react-native';
import { layers, namedFlavor } from '@protomaps/basemaps';

/**
 * Offline map style: Protomaps "light" layers over the region's PMTiles file,
 * Lithuanian labels, local glyphs. Font names are mapped to folder names
 * without spaces so the {fontstack} URL needs no encoding. Icon layers are
 * dropped because no sprite sheet is bundled.
 */
export type OfflineStyle = Exclude<MapProps['mapStyle'], string>;

export function offlineStyle(tilesUri: string, glyphsUri: string): OfflineStyle {
  const base = layers('protomaps', namedFlavor('light'), { lang: 'lt' });
  const mapped = base
    .filter((l) => !(l.layout && 'icon-image' in l.layout))
    .map((l) => {
      if (l.type !== 'symbol' || !l.layout?.['text-font']) return l;
      const fonts = JSON.parse(JSON.stringify(l.layout['text-font']).replace(/Noto Sans (Regular|Medium|Italic)/g, 'Noto-Sans-$1')) as unknown;
      return { ...l, layout: { ...l.layout, 'text-font': fonts } } as typeof l;
    });
  return {
    version: 8,
    glyphs: `${glyphsUri}/{fontstack}/{range}.pbf`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${tilesUri}`,
        attribution: '© OpenStreetMap, Protomaps',
      },
    },
    layers: mapped as OfflineStyle['layers'],
  };
}

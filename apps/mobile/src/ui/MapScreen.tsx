import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { TrustStore } from '@priedanga/alert-format';
import type { PackPlace } from '@priedanga/content-builder/schema';
import { walkRoute, type WalkGraph, type WalkRoute } from '@priedanga/region-builder/route';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDistance, type LatLon } from '../geo';
import { fmt, type Strings } from '../i18n';
import { installGlyphs, listInstalled, loadRegionGraph, pickRegion, verifyInstalled, type InstalledRegion } from '../map/region';
import { offlineStyle } from '../map/style';
import { colors, radius, space } from './theme';

const inBbox = (p: LatLon, b: InstalledRegion['manifest']['bbox']) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;

export function MapScreen(props: {
  places: readonly PackPlace[];
  store: TrustStore;
  t: Strings;
  from: LatLon | null;
  target: PackPlace | null;
  onBack: () => void;
  onRegions: () => void;
}) {
  const { t } = props;
  const [region, setRegion] = useState<InstalledRegion | null>(null);
  const [glyphs, setGlyphs] = useState<string | null>(null);
  const [graph, setGraph] = useState<WalkGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<PackPlace | null>(props.target);
  const [route, setRoute] = useState<WalkRoute | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { regions } = await listInstalled(props.store);
      const picked = pickRegion(regions, props.target ?? props.from);
      if (!picked) throw new Error('none');
      const r = await verifyInstalled(picked.manifest.id, props.store);
      const g = await installGlyphs();
      if (cancelled) return;
      setRegion(r);
      setGlyphs(g);
      const net = await loadRegionGraph(r);
      if (!cancelled) setGraph(net);
    })().catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [props.store]);

  useEffect(() => {
    setRoute(null);
    if (!graph || !props.from || !target) return;
    const id = setTimeout(() => setRoute(walkRoute(graph, props.from!, target)), 0);
    return () => clearTimeout(id);
  }, [graph, props.from, target]);

  const shelters = useMemo(() => {
    if (!region) return null;
    const b = region.manifest.bbox;
    return {
      type: 'FeatureCollection' as const,
      features: props.places
        .filter((p) => (p.k === 0 || p.k === 1) && inBbox(p, b))
        .map((p) => ({ type: 'Feature' as const, id: p.id, properties: { id: p.id, k: p.k }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } })),
    };
  }, [region, props.places]);

  const style = useMemo(() => (region && glyphs ? offlineStyle(region.tilesUri, glyphs) : null), [region, glyphs]);
  const outside = region && props.from && !inBbox(props.from, region.manifest.bbox);
  const center = target ?? props.from ?? (region ? { lat: (region.manifest.bbox.minLat + region.manifest.bbox.maxLat) / 2, lon: (region.manifest.bbox.minLon + region.manifest.bbox.maxLon) / 2 } : null);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.back}>{t.back}</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">
            {region ? `${t.map} · ${region.manifest.name}` : t.map}
          </Text>
          <Pressable onPress={props.onRegions} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.regionsLink}>{t.regions}</Text>
          </Pressable>
        </View>
      </View>

      {error ? (
        <View style={styles.message}>
          <Text style={styles.messageText}>{error.includes('none') ? t.regionMissing : `${t.regionError} (${error})`}</Text>
          <Pressable style={styles.getMaps} onPress={props.onRegions} accessibilityRole="button">
            <Text style={styles.getMapsText}>{t.getMaps}</Text>
          </Pressable>
        </View>
      ) : !style || !center ? (
        <View style={styles.message}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.messageText}>{t.regionLoading}</Text>
        </View>
      ) : (
        <Map style={styles.map} mapStyle={style} logo={false} compass>
          <Camera initialViewState={{ center: [center.lon, center.lat], zoom: 15 }} />
          {shelters ? (
            <GeoJSONSource
              id="shelters"
              data={shelters}
              onPress={(e) => {
                const id = e.nativeEvent.features[0]?.properties?.id as string | undefined;
                const p = id ? props.places.find((x) => x.id === id) : undefined;
                if (p) setTarget(p);
              }}
            >
              <Layer
                id="shelter-dots"
                type="circle"
                paint={{
                  'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 8],
                  'circle-color': ['match', ['get', 'k'], 0, colors.kinds[0], 1, colors.kinds[1], colors.ink],
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 1.5,
                }}
              />
            </GeoJSONSource>
          ) : null}
          {route ? (
            <GeoJSONSource id="route" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coordinates } }}>
              <Layer
                id="route-line"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': route.onNetwork ? colors.accent : colors.warn, 'line-width': 6, 'line-dasharray': route.onNetwork ? [1, 0] : [1, 1.5] }}
              />
            </GeoJSONSource>
          ) : null}
          {target ? (
            <GeoJSONSource id="target" data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [target.lon, target.lat] } }}>
              <Layer id="target-dot" type="circle" paint={{ 'circle-radius': 12, 'circle-color': colors.bad, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 }} />
            </GeoJSONSource>
          ) : null}
          {props.from ? (
            <GeoJSONSource id="me" data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [props.from.lon, props.from.lat] } }}>
              <Layer id="me-dot" type="circle" paint={{ 'circle-radius': 9, 'circle-color': '#1A73E8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 }} />
            </GeoJSONSource>
          ) : null}
        </Map>
      )}

      <View style={styles.card}>
        {outside ? <Text style={styles.warn}>{t.outsideRegion}</Text> : null}
        {target ? (
          <>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {target.n ?? t.kind[target.k]}
            </Text>
            <Text style={styles.cardSub} numberOfLines={1}>
              {[target.a, target.s].filter(Boolean).join(', ')}
            </Text>
            {!props.from ? (
              <Text style={styles.cardSub}>{t.routeNeedsLocation}</Text>
            ) : route ? (
              <>
                <Text style={styles.route}>{fmt(t.routeWalk, { min: route.minutes, dist: formatDistance(route.meters) })}</Text>
                {!route.onNetwork ? <Text style={styles.warn}>{t.routeStraight}</Text> : null}
              </>
            ) : graph ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.cardSub}>{t.regionLoading}</Text>
            )}
          </>
        ) : (
          <Text style={styles.cardSub}>{t.tapShelter}</Text>
        )}
        <Text style={styles.attribution}>© OpenStreetMap, Protomaps</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space(4), paddingTop: space(2), paddingBottom: space(2) },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(1) },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) },
  title: { fontSize: 22, fontWeight: '900', color: colors.ink, flexShrink: 1 },
  regionsLink: { fontSize: 15, color: colors.accent, fontWeight: '700' },
  map: { flex: 1 },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6), gap: space(3) },
  messageText: { fontSize: 16, color: colors.muted, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.line, padding: space(4), gap: space(1) },
  cardTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  cardSub: { fontSize: 14, color: colors.muted },
  route: { fontSize: 20, fontWeight: '900', color: colors.accent, marginTop: space(1) },
  warn: { fontSize: 13, color: colors.warn },
  getMaps: { backgroundColor: colors.accent, borderRadius: radius, paddingVertical: space(3), paddingHorizontal: space(5) },
  getMapsText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  attribution: { fontSize: 11, color: colors.muted, marginTop: space(1) },
  radius: { borderRadius: radius },
});

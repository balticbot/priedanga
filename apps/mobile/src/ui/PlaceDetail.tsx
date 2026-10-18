import type { Municipality } from '@priedanga/content-builder/schema';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { compassIndex, formatDistance, type Nearby } from '../geo';
import { fmt, type Strings } from '../i18n';
import { colors, radius, space } from './theme';

export function PlaceDetail(props: {
  item: Nearby;
  t: Strings;
  municipalities: readonly Municipality[];
  online: boolean;
  onBack: () => void;
}) {
  const { place: p, distance, bearing } = props.item;
  const { t } = props;
  const yn = (v: boolean | null) => (v === null ? t.unknown : v ? t.yes : t.no);
  const municipality = props.municipalities.find((m) => m.code === p.m)?.name ?? String(p.m);

  const rows: [string, string, boolean?][] = [
    [t.address, [p.a, p.s].filter(Boolean).join(', ') || t.unknown],
    [t.municipality, municipality],
  ];
  if (p.k === 3) {
    rows.push([t.sirenRadius, p.r === null ? t.unknown : formatDistance(p.r)]);
  } else {
    rows.push(
      [t.capacity, p.cap === null ? t.unknown : fmt(t.people, { n: p.cap })],
      [t.area, p.area === null ? t.unknown : `${Math.round(p.area)} m²`],
      [t.accessible, yn(p.acc), p.acc === null],
      [t.open24, yn(p.h24), p.h24 === null],
    );
    if (p.hrs) rows.push([t.hours, p.hrs]);
    if (p.k !== 2) {
      rows.push(
        [t.lighting, yn(p.light), p.light === null],
        [t.sanitation, yn(p.san), p.san === null],
        [t.ventilation, yn(p.vent), p.vent === null],
        [t.marked, yn(p.sign), p.sign === null],
      );
    }
  }
  if (p.op) rows.push([t.operator, p.op]);
  if (p.note) rows.push([t.notes, p.note]);
  if (p.upd) rows.push([t.updated, p.upd]);

  const mapsUrl = `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={[styles.kind, { color: colors.kinds[p.k] }]}>{t.kind[p.k]}</Text>
      <Text style={styles.title} accessibilityRole="header">
        {p.n ?? t.kind[p.k]}
      </Text>

      <View style={styles.distanceRow}>
        <Text style={[styles.arrow, { transform: [{ rotate: `${Math.round(bearing)}deg` }] }]} accessibilityElementsHidden>
          ↑
        </Text>
        <View>
          <Text style={styles.distance}>{formatDistance(distance)}</Text>
          <Text style={styles.direction}>
            {t.compass[compassIndex(bearing)]} · {Math.round(bearing)}°
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        {rows.map(([label, value, unknown]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={[styles.value, unknown && styles.unknown]}>{value}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.coords} selectable>
        {p.lat.toFixed(6)}, {p.lon.toFixed(6)}
      </Text>
      {props.online ? (
        <Pressable style={styles.button} onPress={() => Linking.openURL(mapsUrl)} accessibilityRole="link">
          <Text style={styles.buttonText}>{t.openInMaps}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10) },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(4) },
  kind: { fontSize: 15, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink, marginTop: space(1), marginBottom: space(4) },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: space(4), marginBottom: space(4) },
  arrow: { fontSize: 56, fontWeight: '800', color: colors.accent, width: 56, textAlign: 'center' },
  distance: { fontSize: 32, fontWeight: '800', color: colors.ink },
  direction: { fontSize: 16, color: colors.muted },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line },
  row: { paddingVertical: space(3), paddingHorizontal: space(4), borderBottomWidth: 1, borderColor: colors.line },
  label: { fontSize: 14, color: colors.muted, marginBottom: 2 },
  value: { fontSize: 18, color: colors.ink },
  unknown: { color: colors.muted, fontStyle: 'italic' },
  coords: { fontSize: 14, color: colors.muted, marginTop: space(3) },
  button: { marginTop: space(4), padding: space(4), borderRadius: radius, borderWidth: 1.5, borderColor: colors.accent },
  buttonText: { fontSize: 17, color: colors.accent, fontWeight: '700', textAlign: 'center' },
});

import type { TrustStore } from '@priedanga/alert-format';
import type { RegionIndex } from '@priedanga/region-builder/schema';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LatLon } from '../geo';
import { fmt, type Strings } from '../i18n';
import { bboxContains, deleteRegion, downloadRegion, fetchRegionIndex, listInstalled, type InstalledRegion } from '../map/region';
import { colors, radius, space } from './theme';

type Row = { id: string; name: string; bbox: InstalledRegion['manifest']['bbox']; bytes: number; created: string; installed?: InstalledRegion };

export function RegionsScreen(props: { store: TrustStore; t: Strings; online: boolean; position: LatLon | null; onBack: () => void }) {
  const { t } = props;
  const [installed, setInstalled] = useState<InstalledRegion[] | null>(null);
  const [index, setIndex] = useState<RegionIndex | null>(null);
  const [indexError, setIndexError] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setInstalled((await listInstalled(props.store)).regions);
  }, [props.store]);

  useEffect(() => {
    void refresh();
    if (!props.online) return;
    fetchRegionIndex()
      .then(setIndex)
      .catch(() => setIndexError(true));
  }, [refresh, props.online]);

  const rows = new Map<string, Row>();
  for (const r of index?.regions ?? []) rows.set(r.id, { ...r });
  for (const r of installed ?? []) {
    const m = r.manifest;
    const prev = rows.get(m.id);
    rows.set(m.id, { id: m.id, name: m.name, bbox: m.bbox, bytes: prev?.bytes ?? m.files.reduce((n, f) => n + f.bytes, 0), created: prev?.created ?? m.created, installed: r });
  }
  const list = [...rows.values()].sort((a, b) => {
    const here = (r: Row) => (props.position && bboxContains(r.bbox, props.position) ? 0 : 1);
    return here(a) - here(b) || a.name.localeCompare(b.name, 'lt');
  });

  const download = async (id: string) => {
    setErrors((e) => ({ ...e, [id]: '' }));
    setProgress((p) => ({ ...p, [id]: 0 }));
    try {
      await downloadRegion(id, props.store, (f) => setProgress((p) => ({ ...p, [id]: f })));
      await refresh();
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setProgress((p) => {
        const { [id]: _, ...rest } = p;
        return rest;
      });
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {t.regions}
      </Text>
      <Text style={styles.hint}>{t.regionsHint}</Text>
      {!props.online ? <Text style={styles.warn}>{t.regionsOffline}</Text> : indexError ? <Text style={styles.warn}>{t.regionsUnavailable}</Text> : null}
      {installed === null ? <ActivityIndicator color={colors.accent} /> : null}

      {list.map((r) => {
        const p = progress[r.id];
        const newer = r.installed && r.created > r.installed.manifest.created;
        const here = props.position && bboxContains(r.bbox, props.position);
        return (
          <View key={r.id} style={[styles.card, here && styles.cardHere]}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{r.name}</Text>
              <Text style={styles.size}>{(r.bytes / 1e6).toFixed(0)} MB</Text>
            </View>
            {here ? <Text style={styles.here}>{t.yourArea}</Text> : null}
            {r.installed ? <Text style={styles.installed}>✓ {t.installed}</Text> : null}
            {p !== undefined ? (
              <>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.round(p * 100)}%` }]} />
                </View>
                <Text style={styles.size}>{fmt(t.downloading, { pct: Math.round(p * 100) })}</Text>
              </>
            ) : (
              <View style={styles.actions}>
                {(!r.installed || newer) && props.online && index?.regions.some((x) => x.id === r.id) ? (
                  <Pressable style={styles.primary} onPress={() => void download(r.id)} accessibilityRole="button">
                    <Text style={styles.primaryText}>{r.installed ? t.update : t.download}</Text>
                  </Pressable>
                ) : null}
                {r.installed ? (
                  <Pressable
                    style={styles.secondary}
                    onPress={() => {
                      deleteRegion(r.id);
                      void refresh();
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryText}>{t.remove}</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
            {errors[r.id] ? <Text style={styles.error}>{fmt(t.downloadFailed, { error: errors[r.id]! })}</Text> : null}
          </View>
        );
      })}
      <Text style={styles.attribution}>© OpenStreetMap, Protomaps</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10), maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(4) },
  title: { fontSize: 28, fontWeight: '900', color: colors.ink },
  hint: { fontSize: 16, color: colors.muted, marginTop: space(1), marginBottom: space(3) },
  warn: { fontSize: 14, color: colors.warn, marginBottom: space(3) },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space(4), marginBottom: space(3), gap: space(2) },
  cardHere: { borderColor: colors.accent, borderWidth: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  size: { fontSize: 14, color: colors.muted },
  here: { fontSize: 13, fontWeight: '800', color: colors.accent },
  installed: { fontSize: 14, fontWeight: '700', color: colors.ok },
  actions: { flexDirection: 'row', gap: space(2) },
  primary: { backgroundColor: colors.accent, borderRadius: radius, paddingVertical: space(3), paddingHorizontal: space(5) },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  secondary: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius, paddingVertical: space(3), paddingHorizontal: space(5) },
  secondaryText: { color: colors.muted, fontWeight: '700', fontSize: 16 },
  barTrack: { height: 10, backgroundColor: colors.line, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: colors.accent },
  error: { fontSize: 13, color: colors.bad },
  attribution: { fontSize: 11, color: colors.muted, marginTop: space(2) },
});

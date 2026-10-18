import { useNetworkState } from 'expo-network';
import * as Location from 'expo-location';
import type { PackPlace } from '@priedanga/content-builder/schema';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  compassIndex,
  formatDistance,
  inLithuania,
  municipalityCentre,
  nearest,
  sirenCoverage,
  type LatLon,
  type Nearby,
} from './src/geo';
import { fmt, LANGUAGE_NAMES, LANGUAGES, STRINGS, type Lang } from './src/i18n';
import { loadBundledPack, type PackTimings } from './src/pack/loadPack';
import type { VerifyPackResult } from './src/pack/verifyPack';
import { ROOT_IS_DEV } from './src/trust/root';
import { currentAirAlert, isDanger, mergeAlerts } from './src/alerts/alerts';
import { useAlertFeed } from './src/alerts/useAlertFeed';
import { useTiltas } from './src/mesh/useTiltas';
import { AlertPanel, RecentMessages } from './src/ui/AlertPanel';
import { TiltasCard } from './src/ui/TiltasCard';
import { Banner } from './src/ui/Banner';
import { MunicipalityPicker } from './src/ui/MunicipalityPicker';
import { PlaceDetail } from './src/ui/PlaceDetail';
import { CprTool } from './src/ui/CprTool';
import { GuideDetail } from './src/ui/GuideDetail';
import { GuideList } from './src/ui/GuideList';
import { TourniquetTool } from './src/ui/TourniquetTool';
import { topicForAlert } from './src/guidance';
import { useChecklistState } from './src/state/checklistStore';
import { ChecklistDetail, ChecklistIndex } from './src/ui/Checklists';
import { MapScreen } from './src/ui/MapScreen';
import { RegionsScreen } from './src/ui/RegionsScreen';
import { colors, radius, space } from './src/ui/theme';

type Screen =
  | { name: 'home' }
  | { name: 'place'; item: Nearby }
  | { name: 'guides'; group: 'emergency' | 'firstaid' }
  | { name: 'guide'; id: string; from: Screen }
  | { name: 'tool'; tool: 'cpr' | 'tourniquet'; from: Screen }
  | { name: 'map'; target: PackPlace | null; from: Screen }
  | { name: 'regions'; from: Screen }
  | { name: 'checklists' }
  | { name: 'checklist'; id: string };

type Position =
  | { status: 'locating' }
  | { status: 'gps'; pos: LatLon }
  | { status: 'manual'; pos: LatLon; municipality: number }
  | { status: 'failed' }
  | { status: 'outside' };

const NEAREST_LIMIT = 15;
const GPS_TIMEOUT_MS = 12_000;

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [lang, setLang] = useState<Lang>('lt');
  const t = STRINGS[lang];
  const [pack, setPack] = useState<VerifyPackResult | null>(null);
  const [timings, setTimings] = useState<PackTimings | null>(null);
  const [conformance, setConformance] = useState<{ ok: boolean; summary: string } | null>(null);
  const [position, setPosition] = useState<Position>({ status: 'locating' });
  const [kinds, setKinds] = useState<ReadonlySet<number>>(new Set([0, 1]));
  const [accessibleOnly, setAccessibleOnly] = useState(false);
  const [picker, setPicker] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const setSelected = (item: Nearby) => setScreen({ name: 'place', item });
  const home = () => setScreen({ name: 'home' });
  const [checklistState, updateChecklists] = useChecklistState();
  const network = useNetworkState();
  const online = network.isInternetReachable !== false && network.isConnected !== false;

  useEffect(() => {
    loadBundledPack()
      .then(({ result, timings: tm }) => {
        setPack(result);
        setTimings(tm);
      })
      .catch((e: unknown) => setPack({ ok: false, reason: 'MISSING_FILE', detail: String(e) }));
  }, []);

  const runConformance = useCallback(() => {
    setConformance({ ok: true, summary: 'Ed25519 …' });
    import('./src/trust/devConformance')
      .then(({ runNativeConformance }) => runNativeConformance())
      .then(setConformance)
      .catch((e: unknown) => setConformance({ ok: false, summary: `Ed25519 check failed: ${String(e)}` }));
  }, []);

  const locate = useCallback(async () => {
    setPosition({ status: 'locating' });
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return setPosition({ status: 'failed' });
      const fix = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), GPS_TIMEOUT_MS)),
      ]);
      const pos = { lat: fix.coords.latitude, lon: fix.coords.longitude };
      setPosition(inLithuania(pos) ? { status: 'gps', pos } : { status: 'outside' });
    } catch {
      setPosition({ status: 'failed' });
    }
  }, []);

  useEffect(() => {
    void locate();
  }, [locate]);

  const places = pack?.ok ? pack.places : [];
  const pos = position.status === 'gps' || position.status === 'manual' ? position.pos : null;

  const list = useMemo(
    () =>
      pos === null
        ? []
        : nearest(places, pos, NEAREST_LIMIT, (p) => kinds.has(p.k) && (!accessibleOnly || p.acc === true)),
    [places, pos, kinds, accessibleOnly],
  );
  const siren = useMemo(() => (pos === null ? null : sirenCoverage(places, pos)), [places, pos]);

  // The user's municipality: picked manually, or that of the nearest register entry to the GPS fix.
  const areaCode = useMemo(() => {
    if (position.status === 'manual') return position.municipality;
    if (position.status === 'gps') return nearest(places, position.pos, 1, () => true)[0]?.place.m ?? null;
    return null;
  }, [position, places]);
  const feedState = useAlertFeed(pack?.ok ? pack.store : null, online);
  const feedAlerts = useMemo(
    () => (feedState.status === 'ok' ? feedState.feed.alerts : feedState.status === 'error' ? (feedState.last?.alerts ?? []) : []),
    [feedState],
  );
  const feedDanger = useMemo(() => isDanger(currentAirAlert(feedAlerts, areaCode)), [feedAlerts, areaCode]);
  const tiltasNotification = useMemo(() => ({ title: t.tiltasTitle, text: t.tiltasHint }), [t]);
  const tiltas = useTiltas(pack?.ok ? pack.store : null, { online, danger: feedDanger, feedAlerts, notification: tiltasNotification });
  const allAlerts = useMemo(() => mergeAlerts(feedAlerts, tiltas.alerts), [feedAlerts, tiltas.alerts]);
  const current = useMemo(() => currentAirAlert(allAlerts, areaCode), [allAlerts, areaCode]);
  // During an alert the nearest shelter goes straight under the banner, whatever the filters say.
  const nearestShelter = useMemo(
    () => (pos === null || !isDanger(current) ? null : (nearest(places, pos, 1, (p) => p.k === 0 || p.k === 1)[0] ?? null)),
    [places, pos, current],
  );

  if (pack === null) {
    return (
      <SafeAreaView style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loading}>{t.loading}</Text>
      </SafeAreaView>
    );
  }

  if (screen.name === 'place' && pack.ok) {
    return (
      <SafeAreaView style={styles.root}>
        <PlaceDetail
          item={screen.item}
          t={t}
          municipalities={pack.municipalities}
          online={online}
          onBack={home}
          onMap={() => setScreen({ name: 'map', target: screen.item.place, from: screen })}
        />
      </SafeAreaView>
    );
  }
  if (screen.name === 'guides' && pack.ok) {
    return (
      <SafeAreaView style={styles.root}>
        <GuideList
          topics={pack.guidance}
          group={screen.group}
          lang={lang}
          t={t}
          onBack={home}
          onOpen={(id) => setScreen({ name: 'guide', id, from: screen })}
        />
      </SafeAreaView>
    );
  }
  if (screen.name === 'guide' && pack.ok) {
    const topic = pack.guidance.find((x) => x.id === screen.id);
    if (topic) {
      return (
        <SafeAreaView style={styles.root}>
          <GuideDetail
            topic={topic}
            lang={lang}
            t={t}
            online={online}
            onBack={() => setScreen(screen.from)}
            onTool={(tool) => setScreen({ name: 'tool', tool, from: screen })}
          />
        </SafeAreaView>
      );
    }
  }
  if (screen.name === 'map' && pack.ok) {
    return (
      <SafeAreaView style={styles.root}>
        <MapScreen
          places={pack.places}
          store={pack.store}
          t={t}
          from={pos}
          target={screen.target}
          onBack={() => setScreen(screen.from)}
          onRegions={() => setScreen({ name: 'regions', from: screen })}
        />
      </SafeAreaView>
    );
  }
  if (screen.name === 'regions' && pack.ok) {
    return (
      <SafeAreaView style={styles.root}>
        <RegionsScreen store={pack.store} t={t} online={online} position={pos} onBack={() => setScreen(screen.from)} />
      </SafeAreaView>
    );
  }
  if (screen.name === 'checklists' && pack.ok) {
    return (
      <SafeAreaView style={styles.root}>
        <ChecklistIndex
          lists={pack.checklists}
          state={checklistState}
          lang={lang}
          t={t}
          onBack={home}
          onOpen={(id) => setScreen({ name: 'checklist', id })}
        />
      </SafeAreaView>
    );
  }
  if (screen.name === 'checklist' && pack.ok) {
    const list = pack.checklists.find((c) => c.id === screen.id);
    if (list) {
      return (
        <SafeAreaView style={styles.root}>
          <ChecklistDetail
            list={list}
            state={checklistState}
            update={updateChecklists}
            lang={lang}
            t={t}
            onBack={() => setScreen({ name: 'checklists' })}
          />
        </SafeAreaView>
      );
    }
  }
  if (screen.name === 'tool') {
    return (
      <SafeAreaView style={styles.root}>
        {screen.tool === 'cpr' ? <CprTool t={t} onBack={() => setScreen(screen.from)} /> : <TourniquetTool t={t} onBack={() => setScreen(screen.from)} />}
      </SafeAreaView>
    );
  }

  const alertGuide = current && pack.ok ? topicForAlert(pack.guidance, current.alert) : null;

  const toggleKind = (k: number) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next.size === 0 ? prev : next;
    });

  const header = (
    <View>
      <View style={styles.topRow}>
        <Text style={styles.appName} accessibilityRole="header">
          Priedanga
        </Text>
        <Pressable style={styles.sos} onPress={() => Linking.openURL('tel:112')} accessibilityRole="button" accessibilityLabel={t.call112}>
          <Text style={styles.sosText}>112</Text>
        </Pressable>
      </View>

      <View style={styles.langRow}>
        {LANGUAGES.map((l) => (
          <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="button" accessibilityState={{ selected: l === lang }}>
            <Text style={[styles.lang, l === lang && styles.langActive]}>{LANGUAGE_NAMES[l]}</Text>
          </Pressable>
        ))}
      </View>

      {!online ? <Banner tone="warn" title={t.offline} /> : null}

      <AlertPanel
        state={feedState}
        current={current}
        hasArea={areaCode !== null}
        online={online}
        municipalities={pack.ok ? pack.municipalities : []}
        t={t}
        lang={lang}
        onWhatToDo={alertGuide ? () => setScreen({ name: 'guide', id: alertGuide.id, from: { name: 'home' } }) : undefined}
      />
      {nearestShelter ? (
        <View style={styles.urgent}>
          <Text style={styles.urgentTitle}>{t.goToShelter}</Text>
          <PlaceRow item={nearestShelter} t={t} onPress={() => setSelected(nearestShelter)} />
        </View>
      ) : null}
      <TiltasCard tiltas={tiltas} t={t} />

      <View style={styles.guideButtons}>
        <Pressable style={[styles.guideButton, { borderColor: colors.accent }]} onPress={() => setScreen({ name: 'guides', group: 'emergency' })} accessibilityRole="button">
          <Text style={[styles.guideButtonText, { color: colors.accent }]}>{t.emergencyGuides}</Text>
        </Pressable>
        <Pressable style={[styles.guideButton, { borderColor: colors.bad }]} onPress={() => setScreen({ name: 'guides', group: 'firstaid' })} accessibilityRole="button">
          <Text style={[styles.guideButtonText, { color: colors.bad }]}>{t.firstAid}</Text>
        </Pressable>
      </View>
      <View style={styles.guideButtons}>
        <Pressable style={[styles.guideButton, { borderColor: colors.ink }]} onPress={() => setScreen({ name: 'map', target: null, from: { name: 'home' } })} accessibilityRole="button">
          <Text style={[styles.guideButtonText, { color: colors.ink }]}>{t.map}</Text>
        </Pressable>
        <Pressable style={[styles.guideButton, { borderColor: colors.ok }]} onPress={() => setScreen({ name: 'checklists' })} accessibilityRole="button">
          <Text style={[styles.guideButtonText, { color: colors.ok }]}>{t.preparedness}</Text>
        </Pressable>
      </View>

      {pack.ok ? (
        <Pressable disabled={!ROOT_IS_DEV} onPress={runConformance} accessibilityHint={ROOT_IS_DEV ? 'Runs the native Ed25519 conformance check' : undefined}>
          <Text style={styles.packLine}>
            ✓ {t.packVerified} · {fmt(t.packUpdated, { date: pack.manifest.created.slice(0, 10) })} · {fmt(t.places, { n: pack.places.length })}
            {ROOT_IS_DEV ? ` · ${t.devBuild}` : ''}
            {ROOT_IS_DEV && timings?.total !== undefined
              ? ` · ${Math.round(timings.total)} ms (read ${Math.round(timings.read ?? 0)}, sig ${Math.round((timings.trust ?? 0) + (timings.signature ?? 0))}, hash ${Math.round(timings.hash ?? 0)}, parse ${Math.round(timings.parse ?? 0)})`
              : ''}
          </Text>
          {conformance ? (
            <Text style={[styles.packLine, !conformance.ok && styles.conformanceBad]}>{conformance.summary}</Text>
          ) : null}
        </Pressable>
      ) : (
        <Banner tone="bad" title={t.packFailed} body={`${pack.reason}: ${pack.detail}`} />
      )}

      {siren?.nearest ? (
        <Banner
          tone={siren.covered ? 'ok' : 'warn'}
          title={siren.covered ? t.sirenCovered : t.sirenNotCovered}
          body={fmt(t.sirenNearest, {
            d: formatDistance(siren.nearest.distance),
            r: siren.nearest.place.r === null ? t.unknown : formatDistance(siren.nearest.place.r),
          })}
        />
      ) : null}

      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t.nearest}
      </Text>

      <PositionLine position={position} t={t} municipalities={pack.ok ? pack.municipalities : []} />
      <View style={styles.actionsRow}>
        <Pressable style={styles.smallButton} onPress={() => void locate()} accessibilityRole="button">
          <Text style={styles.smallButtonText}>{t.useMyLocation}</Text>
        </Pressable>
        <Pressable style={styles.smallButton} onPress={() => setPicker(true)} accessibilityRole="button">
          <Text style={styles.smallButtonText}>{t.chooseMunicipality}</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {t.kindShort.map((label, k) => (
          <Pressable
            key={label}
            onPress={() => toggleKind(k)}
            style={[styles.chip, kinds.has(k) && { backgroundColor: colors.kinds[k], borderColor: colors.kinds[k] }]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: kinds.has(k) }}
          >
            <Text style={[styles.chipText, kinds.has(k) && styles.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setAccessibleOnly((v) => !v)}
          style={[styles.chip, accessibleOnly && styles.chipDark]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accessibleOnly }}
        >
          <Text style={[styles.chipText, accessibleOnly && styles.chipTextActive]}>♿ {t.accessibleOnly}</Text>
        </Pressable>
      </View>
    </View>
  );

  const footer = (
    <View>
      <RecentMessages alerts={allAlerts} municipalities={pack.ok ? pack.municipalities : []} t={t} />
      <View style={styles.footer}>
        <Text style={styles.footerTitle}>{t.about}</Text>
        <Text style={styles.footerText}>{t.disclaimer}</Text>
        <Text style={styles.footerText}>{t.attribution}</Text>
        {pack.ok ? <Text style={styles.footerText}>{fmt(t.signedBy, { name: pack.signerName })}</Text> : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <FlatList
        data={list}
        keyExtractor={(n) => n.place.id}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <PlaceRow item={item} t={t} onPress={() => setSelected(item)} />}
      />
      {pack.ok ? (
        <MunicipalityPicker
          visible={picker}
          municipalities={pack.municipalities}
          t={t}
          onClose={() => setPicker(false)}
          onPick={(code) => {
            setPicker(false);
            const centre = municipalityCentre(pack.places, code);
            if (centre) setPosition({ status: 'manual', pos: centre, municipality: code });
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function PositionLine(props: { position: Position; t: (typeof STRINGS)[Lang]; municipalities: readonly { code: number; name: string }[] }) {
  const { position: p, t } = props;
  if (p.status === 'locating') {
    return <Text style={styles.positionLine}>{t.locating}</Text>;
  }
  if (p.status === 'failed') return <Banner tone="warn" title={t.locationFailed} />;
  if (p.status === 'outside') return <Banner tone="warn" title={t.locationOutside} />;
  if (p.status === 'manual') {
    const name = props.municipalities.find((m) => m.code === p.municipality)?.name ?? '';
    return <Text style={styles.positionLine}>{fmt(t.approxLocation, { name })}</Text>;
  }
  return null;
}

function PlaceRow({ item, t, onPress }: { item: Nearby; t: (typeof STRINGS)[Lang]; onPress: () => void }) {
  const p = item.place;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`${t.kind[p.k]}, ${p.n ?? ''}, ${formatDistance(item.distance)}, ${t.compass[compassIndex(item.bearing)]}`}
    >
      <View style={[styles.kindBar, { backgroundColor: colors.kinds[p.k] }]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowKind, { color: colors.kinds[p.k] }]}>{t.kind[p.k]}</Text>
        <Text style={styles.rowName} numberOfLines={2}>
          {p.n ?? t.kind[p.k]}
        </Text>
        <Text style={styles.rowAddress} numberOfLines={1}>
          {[p.a, p.s].filter(Boolean).join(', ')}
        </Text>
        <Text style={styles.rowMeta}>
          {p.cap !== null && p.k !== 3 ? fmt(t.people, { n: p.cap }) : ''}
          {p.acc === true ? '  ♿' : ''}
        </Text>
      </View>
      <View style={styles.rowDistance}>
        <Text style={[styles.rowArrow, { transform: [{ rotate: `${Math.round(item.bearing)}deg` }] }]}>↑</Text>
        <Text style={styles.rowDistanceText}>{formatDistance(item.distance)}</Text>
        <Text style={styles.rowDirection}>{t.compass[compassIndex(item.bearing)]}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  loading: { marginTop: space(3), fontSize: 17, color: colors.muted },
  content: { padding: space(4), paddingBottom: space(10), maxWidth: 720, width: '100%', alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(2) },
  appName: { fontSize: 32, fontWeight: '900', color: colors.ink, letterSpacing: -0.5 },
  sos: { backgroundColor: colors.bad, borderRadius: 999, paddingVertical: space(2), paddingHorizontal: space(5) },
  sosText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), marginBottom: space(4) },
  lang: { fontSize: 15, color: colors.muted, paddingVertical: space(1) },
  langActive: { color: colors.ink, fontWeight: '800', textDecorationLine: 'underline' },
  packLine: { fontSize: 13, color: colors.ok, marginBottom: space(3) },
  conformanceBad: { color: colors.bad },
  sectionTitle: { fontSize: 24, fontWeight: '800', color: colors.ink, marginTop: space(2), marginBottom: space(2) },
  positionLine: { fontSize: 15, color: colors.muted, marginBottom: space(2) },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginBottom: space(3) },
  smallButton: { borderWidth: 1.5, borderColor: colors.accent, borderRadius: radius, paddingVertical: space(2), paddingHorizontal: space(3) },
  smallButtonText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginBottom: space(3) },
  chip: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingVertical: space(2), paddingHorizontal: space(3), backgroundColor: colors.card },
  chipDark: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 14, color: colors.ink, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: space(2),
    overflow: 'hidden',
    minHeight: 88,
  },
  kindBar: { width: 6 },
  rowBody: { flex: 1, padding: space(3) },
  rowKind: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowName: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 2 },
  rowAddress: { fontSize: 14, color: colors.muted, marginTop: 2 },
  rowMeta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowDistance: { width: 84, alignItems: 'center', justifyContent: 'center', paddingRight: space(2) },
  rowArrow: { fontSize: 28, fontWeight: '800', color: colors.accent },
  rowDistanceText: { fontSize: 17, fontWeight: '800', color: colors.ink },
  rowDirection: { fontSize: 13, color: colors.muted },
  guideButtons: { flexDirection: 'row', gap: space(2), marginTop: space(2), marginBottom: space(3) },
  guideButton: { flex: 1, borderWidth: 2, borderRadius: radius, padding: space(3), backgroundColor: colors.card, justifyContent: 'center' },
  prepButton: { borderColor: colors.ok, flex: 0, marginBottom: space(3) },
  guideButtonText: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  urgent: { marginTop: space(3), marginBottom: space(2) },
  urgentTitle: { fontSize: 19, fontWeight: '900', color: colors.ink, marginBottom: space(2) },
  footer: { marginTop: space(6), paddingTop: space(4), borderTopWidth: 1, borderColor: colors.line, gap: space(2) },
  footerTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  footerText: { fontSize: 13, color: colors.muted, lineHeight: 19 },
});

import { Level } from '@priedanga/alert-format';
import type { Municipality } from '@priedanga/content-builder/schema';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ShownAlert } from '../alerts/alerts';
import type { FeedState } from '../alerts/useAlertFeed';
import { fmt, type Lang, type Strings } from '../i18n';
import { colors, radius, space } from './theme';

const LEVEL_STYLE: Record<number, { bg: string; fg: string; border: string }> = {
  [Level.Red]: { bg: '#B3121A', fg: '#FFFFFF', border: '#7A0B10' },
  [Level.Yellow]: { bg: '#FFD84D', fg: '#1A1400', border: '#B38F00' },
  [Level.YellowAfterRed]: { bg: '#FFB020', fg: '#1A1000', border: '#A36600' },
  [Level.White]: { bg: colors.okBg, fg: colors.ok, border: colors.ok },
};

const pad = (n: number) => String(n).padStart(2, '0');
export function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function areaNames(codes: readonly number[], municipalities: readonly Municipality[], t: Strings): string {
  if (codes.includes(0)) return t.nationwide;
  const names = codes.map((c) => municipalities.find((m) => m.code === c)?.name ?? String(c));
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

export function AlertPanel(props: {
  state: FeedState;
  current: ShownAlert | null;
  hasArea: boolean;
  online: boolean;
  municipalities: readonly Municipality[];
  t: Strings;
  lang: Lang;
  onWhatToDo?: (() => void) | undefined;
}) {
  const { state, current, t } = props;
  const feed = feedOf(state);

  const status = !props.online
    ? t.feedOffline
    : state.status === 'idle'
      ? t.feedLoading
      : state.status === 'error'
        ? t.feedError
        : fmt(t.feedChecked, { time: formatTime(Math.floor(state.checkedAt / 1000)).slice(11) });

  return (
    <View>
      {current ? (
        <CurrentAlert item={current} municipalities={props.municipalities} t={t} lang={props.lang} onWhatToDo={props.onWhatToDo} />
      ) : (
        <View style={styles.calm} accessibilityRole="summary">
          <Text style={styles.calmTitle}>{props.hasArea ? t.noActiveAir : t.noActiveAirNoArea}</Text>
        </View>
      )}
      <Text style={[styles.status, (!props.online || state.status === 'error') && { color: colors.warn }]}>{status}</Text>
      {feed && feed.rejected > 0 ? <Text style={[styles.status, { color: colors.bad }]}>{fmt(t.rejected, { n: feed.rejected })}</Text> : null}
    </View>
  );
}

function feedOf(state: FeedState) {
  return state.status === 'ok' ? state.feed : state.status === 'error' ? state.last : null;
}

/** Message history. Shown below the shelter list so it never pushes shelters off screen. */
export function RecentMessages(props: { state: FeedState; municipalities: readonly Municipality[]; t: Strings }) {
  const feed = feedOf(props.state);
  const [more, setMore] = useState(false);
  if (!feed || feed.alerts.length === 0) return null;
  const recent = feed.alerts.slice(0, more ? 15 : 4);
  return (
    <View style={styles.recent}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {props.t.recentMessages}
      </Text>
      {recent.map((item) => (
        <MessageRow key={formatTime(item.alert.issued) + (item.alert.sourceRef ?? '')} item={item} municipalities={props.municipalities} t={props.t} />
      ))}
      {feed.alerts.length > 4 ? (
        <Pressable onPress={() => setMore((m) => !m)} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.more}>{more ? props.t.showLess : props.t.showMore}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CurrentAlert({
  item,
  municipalities,
  t,
  lang,
  onWhatToDo,
}: {
  item: ShownAlert;
  municipalities: readonly Municipality[];
  t: Strings;
  lang: Lang;
  onWhatToDo?: (() => void) | undefined;
}) {
  const level = item.alert.level ?? Level.Yellow;
  const s = LEVEL_STYLE[level] ?? LEVEL_STYLE[Level.Yellow]!;
  return (
    <View style={[styles.current, { backgroundColor: s.bg, borderColor: s.border }]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      {item.alert.test ? <Text style={styles.testBadge}>{t.testAlert}</Text> : null}
      <Text style={[styles.currentLevel, { color: s.fg }]}>{t.level[level]}</Text>
      <Text style={[styles.currentMeta, { color: s.fg }]}>
        {formatTime(item.alert.issued)} · {areaNames(item.alert.areas, municipalities, t)}
      </Text>
      {lang !== 'lt' ? <Text style={[styles.caption, { color: s.fg }]}>{t.originalText}</Text> : null}
      <Text style={[styles.currentText, { color: s.fg }]}>{item.alert.text?.lt ?? ''}</Text>
      {item.relayed ? <Text style={[styles.caption, { color: s.fg }]}>{t.relayed}</Text> : null}
      {onWhatToDo ? (
        <Pressable onPress={onWhatToDo} style={[styles.whatToDo, { borderColor: s.fg }]} accessibilityRole="button">
          <Text style={[styles.whatToDoText, { color: s.fg }]}>{t.whatToDo} →</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MessageRow({ item, municipalities, t }: { item: ShownAlert; municipalities: readonly Municipality[]; t: Strings }) {
  const [open, setOpen] = useState(false);
  const a = item.alert;
  const isAir = a.category === 1;
  const label = isAir ? t.level[a.level ?? 1] : t.category[a.category ?? 5];
  const chip = isAir ? (LEVEL_STYLE[a.level ?? 1] ?? LEVEL_STYLE[Level.Yellow]!) : { bg: colors.line, fg: colors.ink, border: colors.line };
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={styles.row} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <View style={styles.rowTop}>
        <Text style={[styles.chip, { backgroundColor: chip.bg, color: chip.fg }]}>
          {a.test ? `TEST · ${label}` : label}
        </Text>
        <Text style={styles.rowTime}>{formatTime(a.issued)}</Text>
      </View>
      <Text style={styles.rowArea}>{areaNames(a.areas, municipalities, t)}</Text>
      <Text style={styles.rowText} numberOfLines={open ? undefined : 3}>
        {a.text?.lt ?? ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  calm: { borderWidth: 1.5, borderColor: colors.ink, borderRadius: radius, padding: space(3), backgroundColor: colors.card },
  calmTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  status: { fontSize: 13, color: colors.muted, marginTop: space(1), marginBottom: space(2) },
  current: { borderWidth: 2, borderRadius: radius, padding: space(4), gap: space(2) },
  currentLevel: { fontSize: 26, fontWeight: '900', letterSpacing: 0.3 },
  currentMeta: { fontSize: 14, fontWeight: '600' },
  currentText: { fontSize: 17, lineHeight: 24 },
  caption: { fontSize: 12, opacity: 0.85 },
  whatToDo: { borderWidth: 2, borderRadius: radius, paddingVertical: space(3), marginTop: space(1) },
  whatToDoText: { fontSize: 18, fontWeight: '900', textAlign: 'center' },
  testBadge: { alignSelf: 'flex-start', backgroundColor: '#111', color: '#fff', fontWeight: '900', fontSize: 13, paddingHorizontal: space(2), paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  recent: { marginTop: space(6), marginBottom: space(3) },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: colors.ink, marginBottom: space(2) },
  row: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space(3), marginBottom: space(2) },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) },
  chip: { fontSize: 12, fontWeight: '800', paddingHorizontal: space(2), paddingVertical: 2, borderRadius: 6, overflow: 'hidden', flexShrink: 1 },
  rowTime: { fontSize: 13, color: colors.muted },
  rowArea: { fontSize: 13, color: colors.muted, marginTop: space(1) },
  rowText: { fontSize: 15, color: colors.ink, marginTop: space(1), lineHeight: 21 },
  more: { fontSize: 15, color: colors.accent, fontWeight: '700', paddingVertical: space(2) },
});

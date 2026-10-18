import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { fmt, type Strings } from '../i18n';
import { colors, radius, space } from './theme';

/** Middle of the ERC range of 100–120 compressions per minute. */
export const CPR_BPM = 110;
const BEAT_MS = 60_000 / CPR_BPM;
/** Pause for two rescue breaths in 30:2 mode (ERC: interruptions under 10 s). */
const BREATHS_MS = 5_000;

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function CprTool({ t, onBack }: { t: Strings; onBack: () => void }) {
  useKeepAwake();
  const [running, setRunning] = useState(false);
  const [withBreaths, setWithBreaths] = useState(false);
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<'push' | 'breaths'>('push');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const scale = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!running) return;
    let n = 0;
    let next = Date.now();
    const beat = () => {
      n += 1;
      setCount(n);
      setPhase('push');
      setNow(Date.now());
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
      Animated.sequence([
        Animated.timing(scale, { toValue: 0.82, duration: BEAT_MS * 0.35, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: BEAT_MS * 0.5, useNativeDriver: true }),
      ]).start();
      if (withBreaths && n >= 30) {
        n = 0;
        next += BEAT_MS + BREATHS_MS;
        timer.current = setTimeout(() => {
          setPhase('breaths');
          setCount(30);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
          timer.current = setTimeout(beat, next - Date.now() - 0);
        }, BEAT_MS);
        return;
      }
      if (!withBreaths && n >= 30) n = 0;
      next += BEAT_MS; // schedule from the ideal time, so the tempo does not drift
      timer.current = setTimeout(beat, Math.max(0, next - Date.now()));
    };
    beat();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [running, withBreaths, scale]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const toggle = () => {
    if (running) {
      setRunning(false);
      setCount(0);
      setPhase('push');
    } else {
      setStartedAt(Date.now());
      setRunning(true);
    }
  };

  const breaths = running && phase === 'breaths';
  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {t.cprTitle}
      </Text>

      <View style={styles.modes}>
        {[false, true].map((b) => (
          <Pressable
            key={String(b)}
            onPress={() => setWithBreaths(b)}
            style={[styles.mode, withBreaths === b && styles.modeActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: withBreaths === b }}
          >
            <Text style={[styles.modeText, withBreaths === b && styles.modeTextActive]}>{b ? t.cprModeBreaths : t.cprModeContinuous}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.center}>
        <Animated.View style={[styles.circle, breaths && styles.circleBreaths, { transform: [{ scale }] }]}>
          <Text style={styles.circleText} accessibilityLiveRegion="polite">
            {!running ? `${CPR_BPM}/min` : breaths ? t.cprBreaths : t.cprPush}
          </Text>
          {running && !breaths ? <Text style={styles.count}>{count}</Text> : null}
        </Animated.View>
        {running && withBreaths ? <Text style={styles.sub}>{fmt(t.cprCount, { n: count })}</Text> : null}
        {running && startedAt ? <Text style={styles.sub}>{fmt(t.cprElapsed, { time: mmss(now - startedAt) })}</Text> : null}
        <Text style={styles.hint}>{t.cprHint}</Text>
      </View>

      <Pressable style={[styles.start, running && styles.stop]} onPress={toggle} accessibilityRole="button">
        <Text style={styles.startText}>{running ? t.cprStop : t.cprStart}</Text>
      </Pressable>
      <Pressable style={styles.call} onPress={() => Linking.openURL('tel:112')} accessibilityRole="button">
        <Text style={styles.callText}>{t.call112}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space(4) },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(3) },
  title: { fontSize: 28, fontWeight: '900', color: colors.ink, marginBottom: space(3) },
  modes: { flexDirection: 'row', gap: space(2) },
  mode: { flex: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius, padding: space(3), backgroundColor: colors.card },
  modeActive: { borderColor: colors.ink, backgroundColor: colors.ink },
  modeText: { fontSize: 14, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  modeTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3) },
  circle: { width: 240, height: 240, borderRadius: 120, backgroundColor: colors.bad, alignItems: 'center', justifyContent: 'center', padding: space(4) },
  circleBreaths: { backgroundColor: colors.accent },
  circleText: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  count: { color: '#fff', fontSize: 44, fontWeight: '900' },
  sub: { fontSize: 18, fontWeight: '700', color: colors.ink },
  hint: { fontSize: 15, color: colors.muted, textAlign: 'center', paddingHorizontal: space(4) },
  start: { backgroundColor: colors.ok, borderRadius: radius, padding: space(5), marginBottom: space(2) },
  stop: { backgroundColor: colors.ink },
  startText: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center' },
  call: { borderWidth: 2, borderColor: colors.bad, borderRadius: radius, padding: space(4), marginBottom: space(2) },
  callText: { color: colors.bad, fontSize: 18, fontWeight: '900', textAlign: 'center' },
});

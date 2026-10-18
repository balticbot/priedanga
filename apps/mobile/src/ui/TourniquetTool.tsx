import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { fmt, type Strings } from '../i18n';
import { colors, radius, space } from './theme';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const hms = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

/** Persisted so the time survives the app being closed. Not available on web. */
function stateFile(): File | null {
  try {
    return new File(Paths.document, 'tourniquet.json');
  } catch {
    return null;
  }
}

export function TourniquetTool({ t, onBack }: { t: Strings; onBack: () => void }) {
  const [appliedAt, setAppliedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const f = stateFile();
    if (f?.exists) {
      f.text()
        .then((txt) => {
          const v = (JSON.parse(txt) as { appliedAt?: unknown }).appliedAt;
          if (typeof v === 'number') setAppliedAt(v);
        })
        .catch(() => undefined);
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = () => {
    const at = Date.now();
    setAppliedAt(at);
    try {
      const f = stateFile();
      if (f) {
        if (!f.exists) f.create();
        f.write(JSON.stringify({ appliedAt: at }));
      }
    } catch {
      // keep the in-memory time even if saving fails
    }
  };
  const reset = () => {
    setAppliedAt(null);
    try {
      const f = stateFile();
      if (f?.exists) f.delete();
    } catch {
      // ignore
    }
  };

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {t.tqTitle}
      </Text>
      <View style={styles.center}>
        {appliedAt === null ? (
          <Pressable style={styles.start} onPress={start} accessibilityRole="button">
            <Text style={styles.startText}>{t.tqStart}</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.applied} accessibilityLiveRegion="polite">
              {fmt(t.tqAppliedAt, { time: hhmm(appliedAt) })}
            </Text>
            <Text style={styles.elapsed}>{fmt(t.tqElapsed, { time: hms(now - appliedAt) })}</Text>
            <Text style={styles.note}>{t.tqWrite}</Text>
            <Text style={styles.kept}>{t.tqKept}</Text>
            <Pressable style={styles.reset} onPress={reset} accessibilityRole="button">
              <Text style={styles.resetText}>{t.tqReset}</Text>
            </Pressable>
          </>
        )}
      </View>
      <Pressable style={styles.call} onPress={() => Linking.openURL('tel:112')} accessibilityRole="button">
        <Text style={styles.callText}>{t.call112}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space(4) },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(3) },
  title: { fontSize: 28, fontWeight: '900', color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(3) },
  start: { backgroundColor: colors.bad, borderRadius: radius, paddingVertical: space(8), paddingHorizontal: space(6), width: '100%' },
  startText: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  applied: { fontSize: 40, fontWeight: '900', color: colors.ink },
  elapsed: { fontSize: 28, fontWeight: '800', color: colors.bad, fontVariant: ['tabular-nums'] },
  note: { fontSize: 18, color: colors.ink, textAlign: 'center', paddingHorizontal: space(2) },
  kept: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  reset: { borderWidth: 1.5, borderColor: colors.line, borderRadius: radius, paddingVertical: space(2), paddingHorizontal: space(5), marginTop: space(4) },
  resetText: { fontSize: 16, color: colors.muted, fontWeight: '700' },
  call: { borderWidth: 2, borderColor: colors.bad, borderRadius: radius, padding: space(4), marginBottom: space(2) },
  callText: { color: colors.bad, fontSize: 18, fontWeight: '900', textAlign: 'center' },
});

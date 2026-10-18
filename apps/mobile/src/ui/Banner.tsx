import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from './theme';

type Tone = 'ok' | 'warn' | 'bad' | 'info';

const toneStyle = {
  ok: { bg: colors.okBg, fg: colors.ok },
  warn: { bg: colors.warnBg, fg: colors.warn },
  bad: { bg: colors.badBg, fg: colors.bad },
  info: { bg: colors.card, fg: colors.ink },
} as const;

export function Banner({ tone, title, body }: { tone: Tone; title: string; body?: string | undefined }) {
  const t = toneStyle[tone];
  return (
    <View style={[styles.box, { backgroundColor: t.bg, borderColor: t.fg }]} accessibilityRole="summary">
      <Text style={[styles.title, { color: t.fg }]}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1.5, borderRadius: radius, padding: space(3), marginBottom: space(3) },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15, color: colors.ink, marginTop: space(1), lineHeight: 21 },
});

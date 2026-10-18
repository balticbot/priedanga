import { StyleSheet, Switch, Text, View } from 'react-native';
import type { TiltasState } from '../mesh/useTiltas';
import { fmt, type Strings } from '../i18n';
import { formatTime } from './AlertPanel';
import { colors, radius, space } from './theme';

/** Tiltas switch and status on the home screen. */
export function TiltasCard({ tiltas, t }: { tiltas: TiltasState; t: Strings }) {
  const s = tiltas.status;
  const problem = !tiltas.available
    ? t.tiltasUnavailable
    : !tiltas.active || !s
      ? null
      : s.bluetooth === 'off'
        ? t.tiltasBtOff
        : s.bluetooth === 'unauthorized'
          ? t.tiltasBtDenied
          : s.bluetooth === 'unsupported'
            ? t.tiltasUnsupported
            : null;
  const state = !tiltas.active
    ? t.tiltasOff
    : tiltas.reason === 'danger'
      ? t.tiltasAutoDanger
      : tiltas.reason === 'offline'
        ? t.tiltasAutoOffline
        : t.tiltasOn;

  return (
    <View style={[styles.card, tiltas.active && !problem && styles.cardOn]}>
      <View style={styles.top}>
        <Text style={styles.title} accessibilityRole="header">
          {t.tiltasTitle}
        </Text>
        <Switch
          value={tiltas.enabled}
          onValueChange={tiltas.setEnabled}
          disabled={!tiltas.available}
          trackColor={{ true: colors.ok, false: colors.line }}
          accessibilityLabel={t.tiltasTitle}
        />
      </View>
      <Text style={[styles.state, tiltas.active && !problem && { color: colors.ok }]}>{state}</Text>
      {problem ? (
        <Text style={styles.problem}>{problem}</Text>
      ) : tiltas.active && s ? (
        <View>
          <Text style={styles.meta}>{fmt(t.tiltasStats, { peers: s.peersSeen, served: s.served })}</Text>
          {s.lastSync ? <Text style={styles.meta}>{fmt(t.tiltasLastSync, { time: formatTime(Math.floor(s.lastSync / 1000)).slice(11) })}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.hint}>{t.tiltasHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space(3), marginTop: space(3) },
  cardOn: { borderColor: colors.ok, borderWidth: 1.5 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3) },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  state: { fontSize: 15, fontWeight: '700', color: colors.muted, marginTop: space(1) },
  problem: { fontSize: 14, fontWeight: '700', color: colors.warn, marginTop: space(1) },
  meta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  hint: { fontSize: 13, color: colors.muted, marginTop: space(2), lineHeight: 18 },
});

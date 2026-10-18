import type { TrustStore } from '@priedanga/alert-format';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LatLon } from '../geo';
import type { Strings } from '../i18n';
import { colors, space } from './theme';

/** Offline maps need the native app; the web build shows a notice. */
export function RegionsScreen(props: { store: TrustStore; t: Strings; online: boolean; position: LatLon | null; onBack: () => void }) {
  return (
    <View style={styles.root}>
      <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{props.t.back}</Text>
      </Pressable>
      <Text style={styles.text}>{props.t.mapWebUnavailable}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space(4) },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(4) },
  text: { fontSize: 17, color: colors.ink },
});

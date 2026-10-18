import type { TrustStore } from '@priedanga/alert-format';
import type { PackPlace } from '@priedanga/content-builder/schema';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LatLon } from '../geo';
import type { Strings } from '../i18n';
import { colors, space } from './theme';

/** The offline map needs the native MapLibre engine; the web build shows a notice instead. */
export function MapScreen(props: { places: readonly PackPlace[]; store: TrustStore; t: Strings; from: LatLon | null; target: PackPlace | null; onBack: () => void }) {
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

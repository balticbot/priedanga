import type { Municipality } from '@priedanga/content-builder/schema';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Strings } from '../i18n';
import { colors, space } from './theme';

export function MunicipalityPicker(props: {
  visible: boolean;
  municipalities: readonly Municipality[];
  t: Strings;
  onPick: (code: number) => void;
  onClose: () => void;
}) {
  const sorted = [...props.municipalities].sort((a, b) => a.name.localeCompare(b.name, 'lt'));
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={props.onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.back}>{props.t.back}</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {props.t.chooseMunicipality}
          </Text>
        </View>
        <FlatList
          data={sorted}
          keyExtractor={(m) => String(m.code)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.line }]}
              onPress={() => props.onPick(item.code)}
              accessibilityRole="button"
            >
              <Text style={styles.rowText}>{item.name}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { padding: space(4), borderBottomWidth: 1, borderColor: colors.line },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(2) },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink },
  row: { paddingVertical: space(4), paddingHorizontal: space(4), borderBottomWidth: 1, borderColor: colors.line },
  rowText: { fontSize: 18, color: colors.ink },
});

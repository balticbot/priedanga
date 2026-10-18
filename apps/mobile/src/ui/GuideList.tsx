import type { GuidanceTopic } from '@priedanga/content-builder/schema';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Lang, Strings } from '../i18n';
import { colors, radius, space } from './theme';

export function GuideList(props: {
  topics: readonly GuidanceTopic[];
  group: GuidanceTopic['group'];
  lang: Lang;
  t: Strings;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const { t, lang } = props;
  const topics = props.topics.filter((x) => x.group === props.group);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {props.group === 'firstaid' ? t.firstAid : t.emergencyGuides}
      </Text>
      {topics.map((topic) => (
        <Pressable
          key={topic.id}
          onPress={() => props.onOpen(topic.id)}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
        >
          <View style={[styles.bar, { backgroundColor: props.group === 'firstaid' ? colors.bad : colors.accent }]} />
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{topic.title[lang]}</Text>
            <Text style={styles.rowSummary}>{topic.summary[lang]}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10), maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(4) },
  title: { fontSize: 28, fontWeight: '900', color: colors.ink, marginBottom: space(4) },
  row: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, marginBottom: space(2), overflow: 'hidden', minHeight: 72 },
  bar: { width: 6 },
  rowBody: { flex: 1, padding: space(3) },
  rowTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  rowSummary: { fontSize: 15, color: colors.muted, marginTop: 2 },
});

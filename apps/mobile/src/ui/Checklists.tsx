import type { Checklist } from '@priedanga/content-builder/schema';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fmt, type Lang, type Strings } from '../i18n';
import type { ChecklistState } from '../state/checklistStore';
import { colors, radius, space } from './theme';

const key = (list: Checklist, itemId: string) => `${list.id}/${itemId}`;
const doneCount = (list: Checklist, state: ChecklistState) => list.items.filter((i) => state.done[key(list, i.id)]).length;

export function ChecklistIndex(props: {
  lists: readonly Checklist[];
  state: ChecklistState;
  lang: Lang;
  t: Strings;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const { t, lang } = props;
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {t.preparedness}
      </Text>
      {props.lists.map((list) => {
        const done = doneCount(list, props.state);
        return (
          <Pressable key={list.id} onPress={() => props.onOpen(list.id)} style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Text style={styles.cardTitle}>{list.title[lang]}</Text>
            <Text style={styles.cardSummary}>{list.summary[lang]}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${(done / list.items.length) * 100}%` }]} />
            </View>
            <Text style={styles.progress}>{fmt(t.progress, { done, total: list.items.length })}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function ChecklistDetail(props: {
  list: Checklist;
  state: ChecklistState;
  update: (fn: (s: ChecklistState) => ChecklistState) => void;
  lang: Lang;
  t: Strings;
  onBack: () => void;
}) {
  const { list, state, update, t, lang } = props;
  const hasAmounts = list.items.some((i) => i.perPerson !== undefined);
  const toggle = (itemId: string) =>
    update((s) => ({ ...s, done: { ...s.done, [key(list, itemId)]: !s.done[key(list, itemId)] } }));
  const setHousehold = (n: number) => update((s) => ({ ...s, household: Math.max(1, Math.min(20, n)) }));
  const done = doneCount(list, state);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {list.title[lang]}
      </Text>
      <Text style={styles.summary}>{list.summary[lang]}</Text>
      <Text style={styles.progress}>{fmt(t.progress, { done, total: list.items.length })}</Text>

      {hasAmounts ? (
        <View style={styles.household}>
          <Text style={styles.householdLabel}>{t.householdSize}</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.stepBtn} onPress={() => setHousehold(state.household - 1)} accessibilityRole="button" accessibilityLabel="−">
              <Text style={styles.stepBtnText}>−</Text>
            </Pressable>
            <Text style={styles.householdValue}>{state.household}</Text>
            <Pressable style={styles.stepBtn} onPress={() => setHousehold(state.household + 1)} accessibilityRole="button" accessibilityLabel="+">
              <Text style={styles.stepBtnText}>+</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {list.items.map((item) => {
        const checked = !!state.done[key(list, item.id)];
        const text = item.perPerson !== undefined ? fmt(item.text[lang], { amount: item.perPerson * state.household }) : item.text[lang];
        return (
          <Pressable
            key={item.id}
            onPress={() => toggle(item.id)}
            style={[styles.item, checked && styles.itemDone]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
          >
            <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={[styles.itemText, checked && styles.itemTextDone]}>{text}</Text>
          </Pressable>
        );
      })}

      <View style={styles.meta}>
        {list.review.status === 'draft' ? <Text style={styles.metaWarn}>{t.reviewDraft}</Text> : null}
        {!list.review.translationsReviewed.includes(lang) ? <Text style={styles.metaWarn}>{t.translationDraft}</Text> : null}
        <Text style={styles.metaTitle}>{t.sourcesTitle}</Text>
        {list.sources.map((s) => (
          <Text key={s.title} style={styles.source}>
            {s.title} ({s.accessed})
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), paddingBottom: space(10), maxWidth: 720, width: '100%', alignSelf: 'center' },
  back: { fontSize: 17, color: colors.accent, fontWeight: '600', marginBottom: space(4) },
  title: { fontSize: 28, fontWeight: '900', color: colors.ink },
  summary: { fontSize: 17, color: colors.muted, marginTop: space(1) },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space(4), marginTop: space(3) },
  cardTitle: { fontSize: 19, fontWeight: '800', color: colors.ink },
  cardSummary: { fontSize: 15, color: colors.muted, marginTop: 2 },
  barTrack: { height: 8, backgroundColor: colors.line, borderRadius: 4, marginTop: space(3), overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.ok },
  progress: { fontSize: 14, color: colors.ok, fontWeight: '700', marginTop: space(2) },
  household: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space(3), marginTop: space(3) },
  householdLabel: { fontSize: 17, fontWeight: '700', color: colors.ink },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 24, fontWeight: '800', color: colors.accent },
  householdValue: { fontSize: 22, fontWeight: '900', color: colors.ink, minWidth: 28, textAlign: 'center' },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3), backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space(3), marginTop: space(2) },
  itemDone: { backgroundColor: colors.okBg, borderColor: colors.ok },
  box: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxChecked: { backgroundColor: colors.ok, borderColor: colors.ok },
  tick: { color: '#fff', fontSize: 18, fontWeight: '900' },
  itemText: { flex: 1, fontSize: 17, lineHeight: 24, color: colors.ink },
  itemTextDone: { color: colors.muted },
  meta: { marginTop: space(6), paddingTop: space(4), borderTopWidth: 1, borderColor: colors.line, gap: space(2) },
  metaWarn: { fontSize: 13, color: colors.warn, lineHeight: 19 },
  metaTitle: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: space(2) },
  source: { fontSize: 13, color: colors.muted, lineHeight: 19 },
});

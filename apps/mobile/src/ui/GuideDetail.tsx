import type { GuidanceTopic } from '@priedanga/content-builder/schema';
import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Lang, Strings } from '../i18n';
import { colors, radius, space } from './theme';

const SPEECH_LANG: Record<Lang, string> = { lt: 'lt', en: 'en', ru: 'ru', pl: 'pl', uk: 'uk' };

/** True if the OS has an offline voice for this language (iOS has no Lithuanian voice, for example). */
function useHasVoice(lang: Lang): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Speech.getAvailableVoicesAsync()
      .then((voices) => {
        if (!cancelled) setHas(voices.some((v) => v.language.toLowerCase().startsWith(SPEECH_LANG[lang])));
      })
      .catch(() => setHas(false));
    return () => {
      cancelled = true;
    };
  }, [lang]);
  return has;
}

export function GuideDetail(props: {
  topic: GuidanceTopic;
  lang: Lang;
  t: Strings;
  online: boolean;
  onBack: () => void;
  onTool: (tool: NonNullable<GuidanceTopic['tool']>) => void;
}) {
  const { topic, lang, t } = props;
  const hasVoice = useHasVoice(lang);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => void Speech.stop(), []);

  const readAloud = () => {
    if (speaking) {
      void Speech.stop();
      setSpeaking(false);
      return;
    }
    const text = [topic.title[lang], ...topic.sections.flatMap((s) => [s.heading[lang], ...s.steps.map((x) => x[lang])])].join('. ');
    setSpeaking(true);
    Speech.speak(text, { language: SPEECH_LANG[lang], onDone: () => setSpeaking(false), onStopped: () => setSpeaking(false), onError: () => setSpeaking(false) });
  };

  const translationUnreviewed = !topic.review.translationsReviewed.includes(lang);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Pressable onPress={props.onBack} accessibilityRole="button" hitSlop={12}>
        <Text style={styles.back}>{t.back}</Text>
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {topic.title[lang]}
      </Text>
      <Text style={styles.summary}>{topic.summary[lang]}</Text>

      <View style={styles.actions}>
        {topic.tool ? (
          <Pressable style={styles.toolButton} onPress={() => props.onTool(topic.tool!)} accessibilityRole="button">
            <Text style={styles.toolButtonText}>{topic.tool === 'cpr' ? t.openCpr : t.openTourniquet}</Text>
          </Pressable>
        ) : null}
        {hasVoice ? (
          <Pressable style={styles.speakButton} onPress={readAloud} accessibilityRole="button">
            <Text style={styles.speakButtonText}>{speaking ? `■ ${t.stopReading}` : `▶ ${t.readAloud}`}</Text>
          </Pressable>
        ) : null}
      </View>

      {topic.sections.map((section, i) => (
        <View key={i} style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {section.heading[lang]}
          </Text>
          {section.steps.map((step, j) => (
            <View key={j} style={styles.step}>
              <Text style={styles.stepNumber}>{j + 1}</Text>
              <Text style={styles.stepText}>{step[lang]}</Text>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.meta}>
        {topic.review.status === 'draft' ? <Text style={styles.metaWarn}>{t.reviewDraft}</Text> : null}
        {translationUnreviewed ? <Text style={styles.metaWarn}>{t.translationDraft}</Text> : null}
        <Text style={styles.metaTitle}>{t.sourcesTitle}</Text>
        {topic.sources.map((src) => (
          <Pressable key={src.title} disabled={!props.online} onPress={() => Linking.openURL(src.url)} accessibilityRole="link">
            <Text style={[styles.source, props.online && styles.sourceLink]}>
              {src.title} ({src.accessed})
            </Text>
          </Pressable>
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
  summary: { fontSize: 17, color: colors.muted, marginTop: space(1), marginBottom: space(3) },
  actions: { gap: space(2), marginBottom: space(2) },
  toolButton: { backgroundColor: colors.bad, borderRadius: radius, padding: space(4) },
  toolButtonText: { color: '#fff', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  speakButton: { borderWidth: 1.5, borderColor: colors.accent, borderRadius: radius, padding: space(3) },
  speakButtonText: { color: colors.accent, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  section: { marginTop: space(4) },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, marginBottom: space(2) },
  step: { flexDirection: 'row', gap: space(3), backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space(3), marginBottom: space(2) },
  stepNumber: { fontSize: 20, fontWeight: '900', color: colors.accent, width: 24, textAlign: 'center' },
  stepText: { flex: 1, fontSize: 18, lineHeight: 26, color: colors.ink },
  meta: { marginTop: space(6), paddingTop: space(4), borderTopWidth: 1, borderColor: colors.line, gap: space(2) },
  metaWarn: { fontSize: 13, color: colors.warn, lineHeight: 19 },
  metaTitle: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: space(2) },
  source: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  sourceLink: { color: colors.accent, textDecorationLine: 'underline' },
});

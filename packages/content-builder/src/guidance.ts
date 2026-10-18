/**
 * Guidance library: source files in content/guidance/*.json, validated and
 * bundled into the signed content pack as guidance.json.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDANCE_LANGS, type Checklist, type GuidanceSource, type GuidanceTopic, type Localized } from './schema.js';

export function loadGuidance(dir: string): GuidanceTopic[] {
  const topics = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const topic = JSON.parse(readFileSync(join(dir, f), 'utf8')) as GuidanceTopic;
      validateTopic(topic, f);
      return topic;
    });
  const ids = new Set<string>();
  for (const t of topics) {
    if (ids.has(t.id)) throw new Error(`duplicate guidance id: ${t.id}`);
    ids.add(t.id);
  }
  return topics.sort((a, b) => a.order - b.order);
}

function checkLocalized(value: Localized | undefined, where: string): void {
  if (value === undefined || typeof value !== 'object') throw new Error(`${where}: missing translations`);
  for (const lang of GUIDANCE_LANGS) {
    const s = value[lang];
    if (typeof s !== 'string' || s.trim() === '') throw new Error(`${where}: missing ${lang}`);
  }
}

export function validateTopic(t: GuidanceTopic, file: string): void {
  const at = (s: string) => `${file} ${s}`;
  if (!/^[a-z0-9-]+$/.test(t.id)) throw new Error(at('id must be kebab-case'));
  if (t.group !== 'emergency' && t.group !== 'firstaid') throw new Error(at('group must be emergency or firstaid'));
  if (!Number.isInteger(t.order)) throw new Error(at('order must be an integer'));
  if (t.tool !== undefined && t.tool !== 'cpr' && t.tool !== 'tourniquet') throw new Error(at('unknown tool'));
  checkLocalized(t.title, at('title'));
  checkLocalized(t.summary, at('summary'));
  if (!Array.isArray(t.sections) || t.sections.length === 0) throw new Error(at('needs sections'));
  t.sections.forEach((s, i) => {
    checkLocalized(s.heading, at(`sections[${i}].heading`));
    if (!Array.isArray(s.steps) || s.steps.length === 0) throw new Error(at(`sections[${i}] needs steps`));
    s.steps.forEach((step, j) => checkLocalized(step, at(`sections[${i}].steps[${j}]`)));
  });
  checkSourcesAndReview(t.sources, t.review, at);
}

function checkSourcesAndReview(sources: GuidanceSource[], review: GuidanceTopic['review'], at: (s: string) => string): void {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error(at('every topic must cite at least one source'));
  for (const src of sources) {
    if (!src.title || !/^https:\/\//.test(src.url) || !/^\d{4}-\d{2}-\d{2}$/.test(src.accessed)) {
      throw new Error(at('sources need title, https url and accessed date'));
    }
  }
  if (!review || !['draft', 'reviewed'].includes(review.status)) throw new Error(at('review.status must be draft or reviewed'));
  if (!Array.isArray(review.translationsReviewed)) throw new Error(at('review.translationsReviewed must be an array'));
}

export function loadChecklists(dir: string): Checklist[] {
  const lists = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const c = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Checklist;
      validateChecklist(c, f);
      return c;
    });
  return lists.sort((a, b) => a.order - b.order);
}

export function validateChecklist(c: Checklist, file: string): void {
  const at = (s: string) => `${file} ${s}`;
  if (!/^[a-z0-9-]+$/.test(c.id)) throw new Error(at('id must be kebab-case'));
  checkLocalized(c.title, at('title'));
  checkLocalized(c.summary, at('summary'));
  if (!Array.isArray(c.items) || c.items.length === 0) throw new Error(at('needs items'));
  const ids = new Set<string>();
  for (const item of c.items) {
    if (!/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id)) throw new Error(at(`bad or duplicate item id ${item.id}`));
    ids.add(item.id);
    checkLocalized(item.text, at(`item ${item.id}`));
    const usesAmount = GUIDANCE_LANGS.some((l) => item.text[l].includes('{amount}'));
    if (usesAmount !== (item.perPerson !== undefined)) throw new Error(at(`item ${item.id}: {amount} and perPerson go together`));
  }
  checkSourcesAndReview(c.sources, c.review, at);
}

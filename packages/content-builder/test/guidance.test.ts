import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGuidance, validateTopic } from '../src/guidance.js';
import type { GuidanceTopic } from '../src/schema.js';

const dir = join(__dirname, '../../../content/guidance');

describe('guidance content', () => {
  const topics = loadGuidance(dir);

  it('loads every topic with all five languages and cited sources', () => {
    expect(topics.length).toBeGreaterThanOrEqual(13);
    for (const t of topics) expect(t.sources.length).toBeGreaterThan(0);
  });

  it('covers every alert level and the chemical and radiation categories', () => {
    const linked = (category: number, level?: number) =>
      topics.some((t) => t.links?.some((l) => l.category === category && (level === undefined || !l.levels || l.levels.includes(level))));
    for (const level of [1, 2, 3, 4]) expect(linked(1, level), `air level ${level}`).toBe(true);
    expect(linked(2)).toBe(true);
    expect(linked(3)).toBe(true);
  });

  it('has first aid with the CPR and tourniquet tools', () => {
    expect(topics.find((t) => t.tool === 'cpr')?.group).toBe('firstaid');
    expect(topics.find((t) => t.tool === 'tourniquet')?.group).toBe('firstaid');
  });

  it('keeps every topic marked as draft until reviewed', () => {
    for (const t of topics) expect(['draft', 'reviewed']).toContain(t.review.status);
  });
});

describe('validateTopic', () => {
  const base = (): GuidanceTopic => JSON.parse(JSON.stringify(loadGuidance(dir)[0])) as GuidanceTopic;

  it('rejects a missing translation', () => {
    const t = base();
    t.sections[0]!.steps[0]!.uk = '';
    expect(() => validateTopic(t, 'x.json')).toThrow(/missing uk/);
  });

  it('rejects a topic without sources', () => {
    const t = base();
    t.sources = [];
    expect(() => validateTopic(t, 'x.json')).toThrow(/source/);
  });
});

describe('checklists', () => {
  it('loads the checklists with per-person quantities wired up', async () => {
    const { loadChecklists } = await import('../src/guidance.js');
    const lists = loadChecklists(join(__dirname, '../../../content/checklists'));
    expect(lists.map((l) => l.id)).toEqual(['go-bag', 'home-supplies', 'family-plan', 'before-leaving']);
    const water = lists.find((l) => l.id === 'home-supplies')!.items.find((i) => i.id === 'water')!;
    expect(water.perPerson).toBe(12);
    expect(water.text.lt).toContain('{amount}');
  });

  it('rejects {amount} without perPerson', async () => {
    const { loadChecklists, validateChecklist } = await import('../src/guidance.js');
    const list = JSON.parse(JSON.stringify(loadChecklists(join(__dirname, '../../../content/checklists'))[1]));
    delete list.items[0].perPerson;
    expect(() => validateChecklist(list, 'x.json')).toThrow(/perPerson/);
  });
});

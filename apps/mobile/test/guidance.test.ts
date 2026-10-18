import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Category, Level, type Alert } from '@priedanga/alert-format';
import type { GuidanceFile } from '@priedanga/content-builder/schema';
import { describe, expect, it } from 'vitest';
import { topicForAlert } from '../src/guidance';

const topics = (JSON.parse(readFileSync(join(__dirname, '../../../packs/dev/guidance.json'), 'utf8')) as GuidanceFile).topics;
const alert = (category: number, level?: number): Alert => ({
  id: new Uint8Array(16),
  issuerKeyId: new Uint8Array(8),
  issued: 0,
  expires: 1,
  msgType: 0,
  category: category as Alert['category'] & number,
  ...(level !== undefined ? { level: level as Level } : {}),
  areas: [0],
  test: false,
});

describe('topicForAlert', () => {
  it('links red and yellow-after-red air alerts to "what to do now"', () => {
    expect(topicForAlert(topics, alert(Category.Air, Level.Red))?.id).toBe('air-alert-now');
    expect(topicForAlert(topics, alert(Category.Air, Level.YellowAfterRed))?.id).toBe('air-alert-now');
  });
  it('links yellow and white to the level explanation', () => {
    expect(topicForAlert(topics, alert(Category.Air, Level.Yellow))?.id).toBe('air-alert-levels');
    expect(topicForAlert(topics, alert(Category.Air, Level.White))?.id).toBe('air-alert-levels');
  });
  it('links chemical and radiation alerts', () => {
    expect(topicForAlert(topics, alert(Category.Chemical, Level.Yellow))?.id).toBe('chemical-accident');
    expect(topicForAlert(topics, alert(Category.Radiation, Level.Yellow))?.id).toBe('nuclear-or-radiation');
  });
  it('offers nothing for plain notices', () => {
    expect(topicForAlert(topics, alert(Category.Other, Level.Yellow))).toBeNull();
  });
});

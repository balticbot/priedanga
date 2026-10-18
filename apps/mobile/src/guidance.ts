import type { Alert } from '@priedanga/alert-format';
import type { GuidanceTopic } from '@priedanga/content-builder/schema';

/** The guidance topic an alert should offer under "What to do", if any. */
export function topicForAlert(topics: readonly GuidanceTopic[], alert: Alert): GuidanceTopic | null {
  for (const t of topics) {
    for (const link of t.links ?? []) {
      if (link.category !== alert.category) continue;
      if (link.levels && (alert.level === undefined || !link.levels.includes(alert.level))) continue;
      return t;
    }
  }
  return null;
}

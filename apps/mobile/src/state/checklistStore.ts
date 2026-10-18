import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useState } from 'react';

/** Ticks per checklist ("listId/itemId") and the household size, saved on the phone only. */
export interface ChecklistState {
  done: Record<string, boolean>;
  household: number;
}

const EMPTY: ChecklistState = { done: {}, household: 2 };

function file(): File | null {
  try {
    return new File(Paths.document, 'checklists.json');
  } catch {
    return null; // web: keep state in memory only
  }
}

export function useChecklistState(): [ChecklistState, (update: (s: ChecklistState) => ChecklistState) => void] {
  const [state, setState] = useState<ChecklistState>(EMPTY);

  useEffect(() => {
    const f = file();
    if (!f?.exists) return;
    f.text()
      .then((txt) => {
        const v = JSON.parse(txt) as Partial<ChecklistState>;
        setState({
          done: typeof v.done === 'object' && v.done !== null ? v.done : {},
          household: typeof v.household === 'number' && v.household >= 1 ? Math.min(20, Math.floor(v.household)) : EMPTY.household,
        });
      })
      .catch(() => undefined);
  }, []);

  const update = useCallback((fn: (s: ChecklistState) => ChecklistState) => {
    setState((prev) => {
      const next = fn(prev);
      try {
        const f = file();
        if (f) {
          if (!f.exists) f.create();
          f.write(JSON.stringify(next));
        }
      } catch {
        // keep the in-memory state even if saving fails
      }
      return next;
    });
  }, []);

  return [state, update];
}

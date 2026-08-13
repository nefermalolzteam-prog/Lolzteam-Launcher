import type { ActionDraft, ActionEntry } from '@shared-types';
import { create } from 'zustand';

interface ActionLogState {
  entries: readonly ActionEntry[];
  loading: boolean;
  /** True once the list has been read at least once. */
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  clear: () => Promise<void>;
}

export const useActionLog = create<ActionLogState>((set, get) => ({
  entries: [],
  loading: false,
  loaded: false,

  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const entries = await window.launcher.actionLog.list();
      set({ entries, loading: false, loaded: true });
    } catch {
      // A journal that cannot be read is not worth an error screen: the page shows its empty state.
      set({ loading: false, loaded: true });
    }
  },

  clear: async () => {
    await window.launcher.actionLog.clear();
    set({ entries: [], loaded: true });
  },
}));

/** Subscribes to the live feed, once, for the lifetime of the window. */
export const initActionLog = (): void => {
  window.launcher.actionLog.onEntry((entry) => {
    useActionLog.setState((state) => ({ entries: [entry, ...state.entries] }));
  });
};

/** Writes down a piece of work the renderer drove itself. */
export const recordAction = (draft: ActionDraft): void => {
  void window.launcher.actionLog.record(draft).catch(() => {
    // The journal is a side effect of the work, never a reason to fail it.
  });
};

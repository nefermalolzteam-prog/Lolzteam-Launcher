import type { LocalServiceId } from '@shared-types';
import { create } from 'zustand';

type Groups = Record<LocalServiceId, string[]>;

const EMPTY: Groups = { steam: [], telegram: [] };

interface LocalGroupsState {
  groups: Groups;
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  /** After a move or a rename — the list may have gained or lost a folder. */
  refresh: () => Promise<void>;
}

const read = async (set: (partial: Partial<LocalGroupsState>) => void): Promise<void> => {
  set({ loading: true });
  try {
    set({ groups: await window.launcher.localAccounts.groups(), loaded: true });
  } catch {
    // A base that cannot be walked is reported where it is read.
  } finally {
    set({ loading: false });
  }
};

export const useLocalGroups = create<LocalGroupsState>((set, get) => ({
  groups: EMPTY,
  loading: false,
  loaded: false,
  load: async () => {
    if (get().loaded || get().loading) return;
    await read(set);
  },
  refresh: () => read(set),
}));

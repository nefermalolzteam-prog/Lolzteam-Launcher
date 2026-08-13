import type { LocalDbEntry } from '@shared-types';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { useInventoryFilters } from './inventoryFilters';
import { useInventorySelection } from './inventorySelection';
import { useLocalGroups } from './localGroups';
import { useLocalLabels } from './localLabels';
import { useSteamChecks } from './steamChecks';
import { forgetTelegramAvatars, useTelegramProfiles } from './telegramProfiles';

interface LocalDbState {
  bases: LocalDbEntry[];
  loading: boolean;
  loaded: boolean;
  /** True while a switch is in flight — the page blocks a second one. */
  switching: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Reads another base. */
  switchTo: (dir: string | null, qc: QueryClient) => Promise<'ok' | 'missing' | 'not_writable'>;
  /** Drops a base from the list. */
  forget: (dir: string) => Promise<void>;
}

/** Everything holding data from the base that is no longer being read. */
const reload = async (qc: QueryClient): Promise<void> => {
  useInventorySelection.getState().clear();
  useInventoryFilters.getState().clearFolders();
  forgetTelegramAvatars();
  await Promise.all([
    qc.invalidateQueries({ queryKey: ['accounts'] }),
    useLocalLabels.getState().refresh(),
    useLocalGroups.getState().refresh(),
    useTelegramProfiles.getState().load(),
    useSteamChecks.getState().load(),
  ]);
};

const read = async (set: (partial: Partial<LocalDbState>) => void): Promise<void> => {
  set({ loading: true });
  try {
    set({ bases: await window.launcher.localDb.list(), loaded: true });
  } catch {
    // A folder that cannot be inspected is reported by main.
  } finally {
    set({ loading: false });
  }
};

export const useLocalDb = create<LocalDbState>((set, get) => ({
  bases: [],
  loading: false,
  loaded: false,
  switching: false,
  load: async () => {
    if (get().loaded || get().loading) return;
    await read(set);
  },
  refresh: () => read(set),
  switchTo: async (dir, qc) => {
    if (get().switching) return 'ok';
    set({ switching: true });
    try {
      const res = await window.launcher.localDb.switchTo(dir);
      if (!res.ok) return res.reason;
      await reload(qc);
      return 'ok';
    } finally {
      set({ switching: false });
      await read(set);
    }
  },
  forget: async (dir) => {
    try {
      set({ bases: await window.launcher.localDb.forget(dir), loaded: true });
    } catch {
      await read(set);
    }
  },
}));

/** After a move: the base list, and everything that came out of the old folder. */
export const reloadAfterDbChange = async (qc: QueryClient): Promise<void> => {
  await reload(qc);
  await useLocalDb.getState().refresh();
};

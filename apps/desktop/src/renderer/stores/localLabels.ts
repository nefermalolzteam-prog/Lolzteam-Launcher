import type { LocalLabel, LocalLabelResult } from '@shared-types';
import { create } from 'zustand';

interface LocalLabelsState {
  labels: LocalLabel[];
  loading: boolean;
  loaded: boolean;
  /** Reads once; call it wherever labels are shown. */
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (id: number | null, title: string, bc: string) => Promise<LocalLabelResult>;
  remove: (id: number) => Promise<LocalLabelResult>;
}

const applyResult = (
  set: (partial: Partial<LocalLabelsState>) => void,
  res: LocalLabelResult,
): LocalLabelResult => {
  if (res.ok) set({ labels: res.labels, loaded: true });
  return res;
};

export const useLocalLabels = create<LocalLabelsState>((set, get) => ({
  labels: [],
  loading: false,
  loaded: false,
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      set({ labels: await window.launcher.localLabels.list(), loaded: true });
    } catch {
      // An unreadable label file is main's to log; the base still works.
    } finally {
      set({ loading: false });
    }
  },
  refresh: async () => {
    set({ loading: true });
    try {
      set({ labels: await window.launcher.localLabels.list(), loaded: true });
    } catch {
    } finally {
      set({ loading: false });
    }
  },
  save: async (id, title, bc) =>
    applyResult(set, await window.launcher.localLabels.save(id, title, bc)),
  remove: async (id) => applyResult(set, await window.launcher.localLabels.remove(id)),
}));

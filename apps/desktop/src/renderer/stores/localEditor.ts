import type { LocalAccountEdit } from '@shared-types';
import { create } from 'zustand';

interface LocalEditorState {
  open: boolean;
  /** `null` = create a new record; otherwise the row being edited. */
  target: LocalAccountEdit | null;
  /** True while the edit form is being fetched from main. */
  loading: boolean;
  openEdit: (itemId: number) => Promise<void>;
  close: () => void;
}

/** Which local-account record is being edited. */
export const useLocalEditor = create<LocalEditorState>((set) => ({
  open: false,
  target: null,
  loading: false,

  // The record's secrets never travel to the renderer.
  openEdit: async (itemId) => {
    set({ loading: true });
    try {
      const form = await window.launcher.localAccounts.form(itemId);
      if (form) set({ open: true, target: form });
    } finally {
      set({ loading: false });
    }
  },

  close: () => set({ open: false, target: null }),
}));

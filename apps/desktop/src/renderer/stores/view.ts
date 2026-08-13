import { create } from 'zustand';

/** `localAdd` is the add-account wizard; it lives under the inventory tab. */
export type ViewId = 'inventory' | 'localAdd' | 'mail' | 'settings';

interface ViewState {
  view: ViewId;
  setView: (view: ViewId) => void;
}

export const useView = create<ViewState>((set) => ({
  view: 'inventory',
  setView: (view) => set({ view }),
}));

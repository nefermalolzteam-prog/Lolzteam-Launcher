import { create } from 'zustand';
import { DEFAULT_SETTINGS_PAGE, type SettingsPageId } from './pages/registry';

interface SettingsPageState {
  page: SettingsPageId;
  setPage: (page: SettingsPageId) => void;
}

/** Which settings page is open. */
export const useSettingsPage = create<SettingsPageState>((set) => ({
  page: DEFAULT_SETTINGS_PAGE,
  setPage: (page) => set({ page }),
}));

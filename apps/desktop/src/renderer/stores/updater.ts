import type { UpdateStatus } from '@shared-ipc';
import { useEffect } from 'react';
import { create } from 'zustand';

interface UpdaterState {
  status: UpdateStatus | null;
  dismissed: boolean;
  setStatus: (status: UpdateStatus) => void;
  dismiss: () => void;
}

export const useUpdater = create<UpdaterState>((set) => ({
  status: null,
  dismissed: false,
  setStatus: (status) =>
    set((prev) => ({
      status,
      dismissed: status.state === 'available' ? false : prev.dismissed,
    })),
  dismiss: () => set({ dismissed: true }),
}));

/** Подписка на главный процесс: единственный источник, наполняющий стор. */
export const useUpdaterFeed = (): void => {
  const setStatus = useUpdater((st) => st.setStatus);

  useEffect(() => {
    const off = window.launcher.updater.onStatus(setStatus);
    void window.launcher.updater.check();
    return off;
  }, [setStatus]);
};

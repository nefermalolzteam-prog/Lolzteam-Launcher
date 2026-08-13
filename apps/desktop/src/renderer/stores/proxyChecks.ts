import { create } from 'zustand';

/** The bulk proxy check, while one is running. */
export interface ProxyCheckRun {
  readonly id: string;
  /** Proxies answered so far — valid or not, an answer either way. */
  readonly done: number;
  /** …and how many of those answers were «работает». */
  readonly ok: number;
  readonly total: number;
  /** Raised by the dock's ✕. */
  readonly cancelled: boolean;
}

interface ProxyChecksState {
  run: ProxyCheckRun | null;
  /** Opens a run and returns its id; any run still standing is superseded. */
  begin: (total: number) => string;
  advance: (id: string, ok: boolean) => void;
  cancel: () => void;
  end: (id: string) => void;
}

export const useProxyChecks = create<ProxyChecksState>((set) => ({
  run: null,
  begin: (total) => {
    const id = crypto.randomUUID();
    set({ run: { id, done: 0, ok: 0, total, cancelled: false } });
    return id;
  },
  // Every mutator is keyed by the run id, so a loop that has been superseded cannot advance or close a run that is no.
  advance: (id, ok) =>
    set((st) =>
      st.run && st.run.id === id
        ? {
            run: {
              ...st.run,
              done: Math.min(st.run.total, st.run.done + 1),
              ok: st.run.ok + (ok ? 1 : 0),
            },
          }
        : st,
    ),
  cancel: () =>
    set((st) => (st.run && !st.run.cancelled ? { run: { ...st.run, cancelled: true } } : st)),
  end: (id) => set((st) => (st.run && st.run.id === id ? { run: null } : st)),
}));

/** Asks the running check to stop — safe to call when there is none. */
export const cancelProxyChecks = (): void => useProxyChecks.getState().cancel();

/** Should the loop that owns `id` stop? */
export const proxyChecksStopped = (id: string): boolean => {
  const run = useProxyChecks.getState().run;
  return run === null || run.id !== id || run.cancelled;
};

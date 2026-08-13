import { useSyncExternalStore } from 'react';

const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

const subscribe = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange);
  if (timer === null) {
    timer = setInterval(() => {
      tick++;
      for (const listener of listeners) listener();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
};

const getSnapshot = (): number => tick;

/** Re-renders the caller every 30 s. */
export const useClockTick = (): number => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

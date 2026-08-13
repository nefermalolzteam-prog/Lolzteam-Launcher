import { create } from 'zustand';
import { IS_DEV } from '~/lib/dev';

/** Тумблеры Debug Menu. */
export interface DebugFlags {
  /** Диалог согласия на телеметрию открыт по требованию, а не по вопросу. */
  metricsConsent: boolean;
  /** Страница «Метрика» рисуется так, будто приёмник настроен. */
  metricsAvailable: boolean;
}

const ALL_OFF: DebugFlags = {
  metricsConsent: false,
  metricsAvailable: false,
};

interface DebugState {
  flags: DebugFlags;
  setFlag: (key: keyof DebugFlags, value: boolean) => void;
  toggleFlag: (key: keyof DebugFlags) => void;
}

export const useDebug = create<DebugState>((set) => ({
  flags: ALL_OFF,
  setFlag: (key, value) =>
    set((st) => (st.flags[key] === value ? st : { flags: { ...st.flags, [key]: value } })),
  toggleFlag: (key) => set((st) => ({ flags: { ...st.flags, [key]: !st.flags[key] } })),
}));

/** Флаг глазами экрана, который его слушает: в сборке для пользователя — всегда `false`. */
export const useDebugFlag = (key: keyof DebugFlags): boolean =>
  useDebug((st) => IS_DEV && st.flags[key]);

/** Тот же ответ вне рендера — например, чтобы закрыть окно, которое сам же открыл. */
export const setDebugFlag = (key: keyof DebugFlags, value: boolean): void =>
  useDebug.getState().setFlag(key, value);

import { type NotifyCategory, type NotifyLevel, isNotifyCategoryEnabled } from '@shared-types';
import { create } from 'zustand';
import { i18n } from '~/i18n';
import { useSettings } from './settings';
import type { TaskText } from './tasks';

/** Same shape as the dock's line, and the same type on purpose. */
export type NotifyText = TaskText;

export interface AppNotification {
  readonly id: string;
  readonly category: NotifyCategory;
  readonly level: NotifyLevel;
  readonly title: NotifyText;
  readonly body: NotifyText | null;
  /** Epoch ms, stamped on arrival — the panel's «5 минут назад». */
  readonly at: number;
  readonly read: boolean;
}

/** A notification as its source states it; the id and the clock are ours. */
export interface NotificationDraft {
  readonly category: NotifyCategory;
  readonly level: NotifyLevel;
  readonly title: NotifyText;
  readonly body?: NotifyText | null;
}

/** How much history the bell keeps. */
const MAX = 50;

interface NotificationsState {
  items: readonly AppNotification[];
  push: (draft: NotificationDraft) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useNotifications = create<NotificationsState>((set) => ({
  items: [],
  push: (draft) =>
    set((state) => ({
      items: [
        {
          id: crypto.randomUUID(),
          category: draft.category,
          level: draft.level,
          title: draft.title,
          body: draft.body ?? null,
          at: Date.now(),
          read: false,
        },
        ...state.items,
      ].slice(0, MAX),
    })),
  // One button for the whole list rather than a per-line «прочитано»: the badge is the only thing the flag drives.
  markAllRead: () =>
    set((state) =>
      state.items.some((n) => !n.read)
        ? { items: state.items.map((n) => (n.read ? n : { ...n, read: true })) }
        : state,
    ),
  remove: (id) =>
    set((state) => {
      const items = state.items.filter((n) => n.id !== id);
      return items.length === state.items.length ? state : { items };
    }),
  clear: () => set((state) => (state.items.length === 0 ? state : { items: [] })),
}));

export const unreadCount = (items: readonly AppNotification[]): number =>
  items.reduce((n, item) => (item.read ? n : n + 1), 0);

const resolve = (text: NotifyText): string => i18n.t(text.key, text.params ?? {});

/** Records an event and, if the user asked for one, raises an OS toast. */
export const notify = (draft: NotificationDraft): void => {
  const settings = useSettings.getState().settings;
  if (settings && !settings.notifications) return;
  if (!isNotifyCategoryEnabled(settings, draft.category)) return;

  useNotifications.getState().push(draft);

  if (settings && !settings.notifySystem) return;
  // Resolved here, not in main: the locale files are in this bundle.
  void window.launcher.notify
    .show({
      title: resolve(draft.title),
      body: draft.body ? resolve(draft.body) : '',
      onlyWhenHidden: settings?.notifyOnlyWhenHidden ?? true,
    })
    .catch(() => {
      // A desktop that draws nothing is not a failure the app can act on; the entry is already on the panel either way.
    });
};

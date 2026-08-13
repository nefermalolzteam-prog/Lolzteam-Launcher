import type { TelegramProfile, TelegramTaskRow } from '@shared-types';
import { telegramCheckSawAccount } from '@shared-types';
import { useEffect, useState } from 'react';
import { create } from 'zustand';

interface TelegramProfilesState {
  profiles: ReadonlyMap<number, TelegramProfile>;
  loaded: boolean;
  /** Bumped when every cached picture is dropped; see `forgetTelegramAvatars`. */
  avatarBump: number;
  load: () => Promise<void>;
  /** Folds one settled row in, so the row and the stored profile never disagree. */
  applyRow: (row: TelegramTaskRow) => void;
}

export const useTelegramProfiles = create<TelegramProfilesState>((set, get) => ({
  profiles: new Map(),
  loaded: false,
  avatarBump: 0,
  load: async () => {
    const list = await window.launcher.telegram.profiles();
    set({ profiles: new Map(list.map((p) => [p.accountId, p])), loaded: true });
  },
  applyRow: (row) => {
    if (!row.check) return;
    const previous = get().profiles.get(row.accountId);
    const profiles = new Map(get().profiles);
    profiles.set(row.accountId, {
      accountId: row.accountId,
      status: row.check.status,
      userId: row.check.userId ?? previous?.userId ?? null,
      phone: row.check.phone ?? previous?.phone ?? null,
      username: row.check.username ?? previous?.username ?? null,
      name: row.check.name || (previous?.name ?? ''),
      // Same rule as the store in main: a verdict that never reached `getMe` knows nothing about Premium.
      premium: telegramCheckSawAccount(row.check)
        ? row.check.premium
        : (previous?.premium ?? false),
      country: row.check.country ?? previous?.country ?? null,
      spam: row.check.spam ?? previous?.spam ?? null,
      sessions: row.check.sessions ?? previous?.sessions ?? null,
      // The picture is on disk by now, but the bytes never travel in a row — whether one exists is main's answer.
      hasAvatar: previous?.hasAvatar ?? false,
      checkedAt: Date.now(),
      detail: row.check.detail,
    });
    set({ profiles });
  },
}));

/** Avatars, fetched one at a time and remembered for the session. */
const cache = new Map<string, Promise<string | null>>();

export const forgetTelegramAvatars = (): void => {
  cache.clear();
  useTelegramProfiles.setState((s) => ({ avatarBump: s.avatarBump + 1 }));
};

export const loadTelegramAvatar = (accountId: number): Promise<string | null> => {
  const key = `${useTelegramProfiles.getState().avatarBump}:${accountId}`;
  const pending = cache.get(key);
  if (pending) return pending;
  const promise = window.launcher.telegram.avatar(accountId).catch(() => null);
  cache.set(key, promise);
  return promise;
};

/** The account's picture as a data URL, or null while there is none to show. */
export const useTelegramAvatar = (accountId: number, enabled: boolean): string | null => {
  const bump = useTelegramProfiles((s) => s.avatarBump);
  const [src, setSrc] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `bump` is not read here — it is the invalidation signal, and re-running the fetch is exactly what it is for
  useEffect(() => {
    if (!enabled) {
      setSrc(null);
      return;
    }
    let alive = true;
    void loadTelegramAvatar(accountId).then((value) => {
      if (alive) setSrc(value);
    });
    return () => {
      alive = false;
    };
  }, [accountId, enabled, bump]);
  return src;
};

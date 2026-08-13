import type { SteamCheckRecord, TelegramTaskRow } from '@shared-types';
import { create } from 'zustand';

interface SteamChecksState {
  checks: ReadonlyMap<number, SteamCheckRecord>;
  loaded: boolean;
  load: () => Promise<void>;
  /** Folds one settled row in, so the row and the stored verdict never disagree. */
  applyRow: (row: TelegramTaskRow) => void;
}

export const useSteamChecks = create<SteamChecksState>((set, get) => ({
  checks: new Map(),
  loaded: false,
  load: async () => {
    const list = await window.launcher.steam.checks();
    set({ checks: new Map(list.map((c) => [c.accountId, c])), loaded: true });
  },
  applyRow: (row) => {
    if (!row.steam) return;
    const previous = get().checks.get(row.accountId);
    const checks = new Map(get().checks);
    checks.set(row.accountId, {
      accountId: row.accountId,
      status: row.steam.status,
      // Same rule as the store in main: a profile page that could not be fetched is a block of nulls.
      steamId: row.steam.steamId ?? previous?.steamId ?? null,
      nickname: row.steam.nickname ?? previous?.nickname ?? null,
      vacBanned: row.steam.vacBanned ?? previous?.vacBanned ?? null,
      tradeBanState: row.steam.tradeBanState ?? previous?.tradeBanState ?? null,
      limited: row.steam.limited ?? previous?.limited ?? null,
      privacy: row.steam.privacy ?? previous?.privacy ?? null,
      memberSince: row.steam.memberSince ?? previous?.memberSince ?? null,
      avatarUrl: row.steam.avatarUrl ?? previous?.avatarUrl ?? null,
      detail: row.steam.detail,
      checkedAt: Date.now(),
    });
    set({ checks });
  },
}));

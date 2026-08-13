import type { SteamCheckDetail, SteamCheckInfo, SteamCheckRecord } from '@shared-types';
import { CHECK_FILE } from './db-paths';
import { SidecarStore } from './sidecar-store';

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const asFlag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

const parseDetail = (v: unknown): SteamCheckDetail | null =>
  v === 'refused' || v === 'unknown' ? v : null;

const parseCheck = (v: unknown, accountId: number): SteamCheckRecord | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const status = r.status;
  // The verdict is the whole record.
  if (status !== 'alive' && status !== 'dead' && status !== 'unlinked') return null;

  return {
    // The folder names the account; the field inside is only what the machine that wrote it happened to call it.
    accountId,
    status,
    steamId: asString(r.steamId),
    nickname: asString(r.nickname),
    vacBanned: asFlag(r.vacBanned),
    tradeBanState: asString(r.tradeBanState),
    limited: asFlag(r.limited),
    privacy: asString(r.privacy),
    memberSince: asString(r.memberSince),
    avatarUrl: asString(r.avatarUrl),
    detail: parseDetail(r.detail),
    checkedAt: typeof r.checkedAt === 'number' && Number.isInteger(r.checkedAt) ? r.checkedAt : 0,
  };
};

const store = new SidecarStore<SteamCheckRecord>({
  service: 'steam',
  file: CHECK_FILE,
  tag: '[steam/check]',
  parse: parseCheck,
});

export const listSteamChecks = (): Promise<SteamCheckRecord[]> => store.list();

export const getSteamCheck = (accountId: number): Promise<SteamCheckRecord | null> =>
  store.get(accountId);

/** Stores the result of one check. */
export const saveSteamCheck = (accountId: number, info: SteamCheckInfo): Promise<boolean> =>
  store.save(accountId, (previous) => ({
    accountId,
    status: info.status,
    steamId: info.steamId ?? previous?.steamId ?? null,
    nickname: info.nickname ?? previous?.nickname ?? null,
    vacBanned: info.vacBanned ?? previous?.vacBanned ?? null,
    tradeBanState: info.tradeBanState ?? previous?.tradeBanState ?? null,
    limited: info.limited ?? previous?.limited ?? null,
    privacy: info.privacy ?? previous?.privacy ?? null,
    memberSince: info.memberSince ?? previous?.memberSince ?? null,
    avatarUrl: info.avatarUrl ?? previous?.avatarUrl ?? null,
    detail: info.detail,
    checkedAt: Date.now(),
  }));

export const deleteSteamCheck = (accountId: number): Promise<boolean> => store.remove(accountId);

export const resetSteamCheckStoreForTests = (): void => store.resetForTests();

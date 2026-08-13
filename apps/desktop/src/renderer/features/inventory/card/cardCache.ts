import type { AccountSummary, AccountTag } from '@shared-types';
import type { QueryClient } from '@tanstack/react-query';

/** The query key `useInventory` publishes the account list under. */
export const ACCOUNTS_KEY = ['accounts'];

/** The same tags, everywhere this summary keeps a copy of them. */
export const withTags = (item: AccountSummary, tags: AccountTag[]): AccountSummary => {
  const next: AccountSummary = { ...item, tags };
  if (item.steam) next.steam = { ...item.steam, tags };
  if (item.telegram) next.telegram = { ...item.telegram, tags };
  if (item.discord) next.discord = { ...item.discord, tags };
  if (item.instagram) next.instagram = { ...item.instagram, tags };
  if (item.tiktok) next.tiktok = { ...item.tiktok, tags };
  return next;
};

/** Rewrites one account in the cached list, leaving every other one identical. */
const patchAccount = (
  qc: QueryClient,
  itemId: number,
  patch: (item: AccountSummary) => AccountSummary,
): void => {
  qc.setQueryData<AccountSummary[]>(ACCOUNTS_KEY, (prev) =>
    prev?.map((it) => (it.itemId === itemId ? patch(it) : it)),
  );
};

export const patchAccountTags = (
  qc: QueryClient,
  itemId: number,
  transform: (tags: AccountTag[]) => AccountTag[],
): void => patchAccount(qc, itemId, (it) => withTags(it, transform(it.tags ?? [])));

export const patchAccountNote = (qc: QueryClient, itemId: number, note: string | null): void =>
  patchAccount(qc, itemId, (it) => ({ ...it, note }));

/** A label was hung, a folder was changed — the projection did it. */
export const reloadAccounts = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: ACCOUNTS_KEY });
};

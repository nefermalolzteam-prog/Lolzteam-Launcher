import type { AccountScope, AccountSummary, InventorySortKey } from '@shared-types';
import { type CheckSources, lastCheckedAt } from './accountValidity';

export type SortKey = InventorySortKey;
export type SortDir = 'asc' | 'desc';

/** What the grid can be ordered by, per scope. */
const MARKET_SORT_KEYS = ['purchased', 'price', 'warranty', 'title', 'checked'] as const;
const LOCAL_SORT_KEYS = ['purchased', 'title', 'checked'] as const;

export const sortKeysFor = (scope: AccountScope): readonly SortKey[] =>
  scope === 'local' ? LOCAL_SORT_KEYS : MARKET_SORT_KEYS;

export const searchHaystack = (item: AccountSummary, src: CheckSources): string => {
  // What a check learned is searchable too: a Telegram account filed under a phone number is looked for by the name on it.
  const profile = src.profiles.get(item.itemId);
  const check = src.checks.get(item.itemId);
  const parts: (string | null | undefined)[] = [
    item.title,
    item.categoryTitle,
    item.folder,
    // The user's own words about the account, which is exactly what he will search for when he cannot remember which of five.
    item.note,
    item.steam?.country,
    item.telegram?.country,
    item.telegram?.username,
    item.telegram?.phone,
    item.discord?.locale,
    item.instagram?.username,
    item.instagram?.country,
    item.tiktok?.username,
    item.tiktok?.screenName,
    profile?.name,
    profile?.username,
    profile?.phone,
    check?.nickname,
    check?.steamId,
    ...item.tags.map((tag) => tag.title),
    ...(item.steam?.games.map((g) => g.title) ?? []),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
};

export const matchesQuery = (item: AccountSummary, query: string, src: CheckSources): boolean => {
  if (!query) return true;
  const haystack = searchHaystack(item, src);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
};

/** `null` means «this account cannot answer», and is always sorted last. */
type SortValue = number | string | null;

const sortValue = (item: AccountSummary, key: SortKey, src: CheckSources): SortValue => {
  switch (key) {
    case 'purchased':
      return item.purchasedAt;
    case 'price':
      return item.price;
    case 'warranty':
      return item.warrantyEndsAt;
    case 'title':
      return item.title.trim().toLowerCase() || null;
    case 'checked':
      return lastCheckedAt(item, src);
  }
};

export const compareItems = (
  a: AccountSummary,
  b: AccountSummary,
  key: SortKey,
  dir: SortDir,
  src: CheckSources,
): number => {
  const va = sortValue(a, key, src);
  const vb = sortValue(b, key, src);
  // «Unknown» sinks in both directions: flipping the arrow is meant to reorder the accounts that have an answer.
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  const diff =
    typeof va === 'string' && typeof vb === 'string'
      ? va.localeCompare(vb)
      : Number(va) - Number(vb);
  return dir === 'asc' ? diff : -diff;
};

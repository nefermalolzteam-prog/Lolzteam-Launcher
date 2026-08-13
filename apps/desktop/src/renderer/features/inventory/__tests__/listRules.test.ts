import type { AccountSummary, SteamCheckRecord, TelegramProfile } from '@shared-types';
import { describe, expect, it } from 'vitest';
import type { CheckSources } from '../accountValidity';
import { compareItems, matchesQuery, searchHaystack, sortKeysFor } from '../listRules';

const item = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  itemId: 1,
  category: 'steam',
  categoryRaw: 'steam',
  categoryTitle: 'Steam',
  title: 'Account',
  description: '',
  price: 0,
  currency: '',
  imageUrl: null,
  tags: [],
  warrantyEndsAt: null,
  publishedAt: null,
  purchasedAt: null,
  isPurchased: false,
  scope: 'purchased',
  steam: null,
  telegram: null,
  discord: null,
  instagram: null,
  tiktok: null,
  llmService: null,
  llm: null,
  hasEmailLogin: false,
  hasMafile: null,
  note: null,
  folder: null,
  marketItemId: null,
  localCopyId: null,
  ...over,
});

const profile = (over: Partial<TelegramProfile>): TelegramProfile => ({
  accountId: 1,
  status: 'alive',
  userId: null,
  phone: null,
  username: null,
  name: '',
  premium: false,
  country: null,
  spam: null,
  sessions: null,
  hasAvatar: false,
  checkedAt: 0,
  detail: null,
  ...over,
});

const check = (over: Partial<SteamCheckRecord>): SteamCheckRecord => ({
  accountId: 1,
  status: 'alive',
  steamId: null,
  nickname: null,
  vacBanned: null,
  tradeBanState: null,
  limited: null,
  privacy: null,
  memberSince: null,
  avatarUrl: null,
  detail: null,
  checkedAt: 0,
  ...over,
});

const sources = (
  profiles: [number, TelegramProfile][] = [],
  checks: [number, SteamCheckRecord][] = [],
): CheckSources => ({ profiles: new Map(profiles), checks: new Map(checks) });

const EMPTY = sources();

describe('sortKeysFor', () => {
  // Price and warranty are questions only a bought account can answer.
  it('offers price and warranty on the market scopes only', () => {
    expect(sortKeysFor('purchased')).toContain('price');
    expect(sortKeysFor('listed')).toContain('warranty');
    expect(sortKeysFor('local')).not.toContain('price');
    expect(sortKeysFor('local')).not.toContain('warranty');
  });

  it('keeps date, name and check on every scope', () => {
    for (const scope of ['purchased', 'listed', 'local'] as const) {
      expect(sortKeysFor(scope)).toEqual(expect.arrayContaining(['purchased', 'title', 'checked']));
    }
  });
});

describe('searchHaystack', () => {
  it('folds in the folder, the labels and what a check learned', () => {
    const hay = searchHaystack(
      item({
        itemId: -3,
        title: 'Основной',
        folder: 'Работа',
        tags: [{ id: -1, title: 'Продажа', bc: '#fff' }],
      }),
      sources([[-3, profile({ name: 'Ivan', username: 'durov', phone: '+79001234567' })]]),
    );
    expect(hay).toContain('работа');
    expect(hay).toContain('продажа');
    expect(hay).toContain('durov');
    expect(hay).toContain('+79001234567');
  });

  it('reads a Steam nickname off the check, which the summary never carries', () => {
    const hay = searchHaystack(
      item({ itemId: 7 }),
      sources([], [[7, check({ nickname: 'xXpro' })]]),
    );
    expect(hay).toContain('xxpro');
  });

  // The one field the user wrote himself, and therefore the one he will type into the search box when he cannot remember.
  it('folds in the market note', () => {
    const hay = searchHaystack(item({ note: 'Для сборки CS2, не продавать' }), EMPTY);
    expect(hay).toContain('сборки cs2');
  });
});

describe('matchesQuery', () => {
  const it7 = item({ itemId: 7, title: 'Main Steam', folder: 'Продажа' });
  const src = sources([], [[7, check({ nickname: 'Kolya' })]]);

  it('lets everything through on an empty query', () => {
    expect(matchesQuery(it7, '', EMPTY)).toBe(true);
  });

  // Terms are ANDed and may come from different fields.
  it('needs every term, from any field, in any case', () => {
    expect(matchesQuery(it7, 'STEAM kolya', src)).toBe(true);
    expect(matchesQuery(it7, 'steam продажа', src)).toBe(true);
    expect(matchesQuery(it7, 'steam vasya', src)).toBe(false);
  });
});

describe('compareItems', () => {
  const sortWith = (
    items: AccountSummary[],
    ...rest: [Parameters<typeof compareItems>[2], Parameters<typeof compareItems>[3], CheckSources]
  ) => [...items].sort((a, b) => compareItems(a, b, ...rest)).map((i) => i.title);

  it('orders by name in the alphabet, not by id', () => {
    const items = [item({ title: 'Ветка' }), item({ title: 'Аврора' }), item({ title: 'бета' })];
    expect(sortWith(items, 'title', 'asc', EMPTY)).toEqual(['Аврора', 'бета', 'Ветка']);
    expect(sortWith(items, 'title', 'desc', EMPTY)).toEqual(['Ветка', 'бета', 'Аврора']);
  });

  // Flipping the arrow must reorder the accounts that have an answer, not float the ones that have none.
  it('sinks an unanswerable value in both directions', () => {
    const items = [
      item({ title: 'no date', purchasedAt: null }),
      item({ title: 'old', purchasedAt: 100 }),
      item({ title: 'new', purchasedAt: 200 }),
    ];
    expect(sortWith(items, 'purchased', 'desc', EMPTY)).toEqual(['new', 'old', 'no date']);
    expect(sortWith(items, 'purchased', 'asc', EMPTY)).toEqual(['old', 'new', 'no date']);
  });

  it('orders by the last check, whichever service did the checking', () => {
    const src = sources(
      [[1, profile({ checkedAt: 50 })]],
      [
        [2, check({ checkedAt: 90 })],
        [1, check({ checkedAt: 10 })],
      ],
    );
    const items = [
      item({ itemId: 3, title: 'never' }),
      item({ itemId: 1, title: 'telegram' }),
      item({ itemId: 2, title: 'steam' }),
    ];
    // Account 1 was seen by both sidecars; the newer of the two is what counts.
    expect(sortWith(items, 'checked', 'desc', src)).toEqual(['steam', 'telegram', 'never']);
  });

  it('treats a blank name as unanswerable rather than as the first letter', () => {
    const items = [item({ title: '   ' }), item({ title: 'Zeta' })];
    expect(sortWith(items, 'title', 'asc', EMPTY)).toEqual(['Zeta', '   ']);
  });
});

import type {
  AccountSummary,
  SteamCheckRecord,
  SteamInfo,
  TelegramInfo,
  TelegramProfile,
} from '@shared-types';
import { TG_SPAM_FOREVER, TG_SPAM_NONE } from '@shared-types';
import { describe, expect, it } from 'vitest';
import type { CheckSources } from '../accountValidity';
import { attributesFor, matchesAttributes } from '../attributes';

const item = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  itemId: 1,
  category: 'telegram',
  categoryRaw: 'telegram',
  categoryTitle: 'Telegram',
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

const telegram = (over: Partial<TelegramInfo> = {}): TelegramInfo => ({
  phone: null,
  username: null,
  id: null,
  country: null,
  lastSeen: null,
  premium: false,
  premiumExpires: null,
  spamBlocked: false,
  spamBlock: null,
  tags: [],
  origin: null,
  channelsCount: null,
  chatsCount: null,
  contactsCount: null,
  conversationsCount: null,
  adminCount: null,
  adminSubsCount: null,
  starsCount: null,
  birthday: null,
  passwordSet: false,
  ...over,
});

const steam = (over: Partial<SteamInfo> = {}): SteamInfo => ({
  tags: [],
  level: null,
  gameCount: null,
  isLimited: false,
  lastActivity: null,
  vacBanned: false,
  communityBanned: false,
  tradeBanned: false,
  balance: null,
  origin: null,
  country: null,
  games: [],
  vacCount: null,
  cs2BanActive: false,
  cs2BanDate: null,
  marketBanEndsAt: null,
  chineseAccount: false,
  limitSpent: null,
  convertedBalance: null,
  inventoryValue: null,
  hoursRecent: null,
  lastTransaction: null,
  registerDate: null,
  points: null,
  friendCount: null,
  faceitLevel: null,
  giftCount: null,
  ...over,
});

const profile = (over: Partial<TelegramProfile> = {}): TelegramProfile => ({
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

const check = (over: Partial<SteamCheckRecord> = {}): SteamCheckRecord => ({
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

/** One chip at a time, which is how the grid reads all but the trivial case. */
const holds = (id: string, it: AccountSummary, src: CheckSources = EMPTY): boolean =>
  matchesAttributes(it, [id], src);

describe('attributesFor', () => {
  it('offers the common chips plus that service’s, and nothing else', () => {
    const tg = attributesFor('telegram').map((a) => a.id);
    expect(tg).toContain('hasEmail');
    expect(tg).toContain('tgPremium');
    expect(tg).not.toContain('steamMafile');
    expect(attributesFor('all').map((a) => a.id)).toEqual(['hasEmail', 'hasNote']);
  });
});

describe('matchesAttributes', () => {
  it('lets everything through when nothing is selected', () => {
    expect(matchesAttributes(item(), [], EMPTY)).toBe(true);
  });

  // A chip id left in the persisted filters by an older build must not filter the whole grid away.
  it('ignores an id that no longer exists', () => {
    expect(holds('tgWasHere', item())).toBe(true);
  });

  it('needs every selected chip to hold, not just one', () => {
    const both = item({ hasEmailLogin: true, telegram: telegram({ premium: true }) });
    expect(matchesAttributes(both, ['hasEmail', 'tgPremium'], EMPTY)).toBe(true);
    expect(
      matchesAttributes({ ...both, hasEmailLogin: false }, ['hasEmail', 'tgPremium'], EMPTY),
    ).toBe(false);
  });
});

describe('hasNote', () => {
  // The one chip that asks about the user rather than about the account: it holds exactly when he wrote something down.
  it('holds only where the market kept a note', () => {
    expect(holds('hasNote', item({ note: 'Для сборки CS2' }))).toBe(true);
    expect(holds('hasNote', item({ note: null }))).toBe(false);
    expect(holds('hasNote', item({ itemId: -4, scope: 'local' }))).toBe(false);
  });
});

describe('tgPremium', () => {
  it('reads the market badge on a bought account', () => {
    expect(holds('tgPremium', item({ telegram: telegram({ premium: true }) }))).toBe(true);
    expect(holds('tgPremium', item({ telegram: telegram() }))).toBe(false);
  });

  // The point of the whole exercise: a hand-added account has no badge object.
  it('reads a local check on an account the market never sold us', () => {
    const local = item({ itemId: -4, telegram: null, scope: 'local' });
    expect(holds('tgPremium', local, sources([[-4, profile({ premium: true })]]))).toBe(true);
    expect(holds('tgPremium', local, sources([[-4, profile({ premium: false })]]))).toBe(false);
    expect(holds('tgPremium', local)).toBe(false);
  });
});

describe('tgNoSpam', () => {
  it('reads the market ladder when nobody asked the @SpamBot', () => {
    expect(holds('tgNoSpam', item({ telegram: telegram({ spamBlock: TG_SPAM_NONE }) }))).toBe(true);
    expect(holds('tgNoSpam', item({ telegram: telegram({ spamBlock: TG_SPAM_FOREVER }) }))).toBe(
      false,
    );
    // «Не проверяли» is not «чисто».
    expect(holds('tgNoSpam', item({ telegram: telegram({ spamBlock: null }) }))).toBe(false);
  });

  it('prefers the verdict our own probe brought back', () => {
    const it4 = item({ itemId: 4, telegram: telegram({ spamBlock: TG_SPAM_NONE }) });
    const blocked = sources([[4, profile({ spam: { status: 'blocked', until: null } })]]);
    expect(holds('tgNoSpam', it4, blocked)).toBe(false);
    const free = sources([[4, profile({ spam: { status: 'free', until: null } })]]);
    expect(holds('tgNoSpam', item({ itemId: 4 }), free)).toBe(true);
  });

  // The probe writes from the account, so it is opt-in and most profiles carry no verdict at all.
  it('falls through to the market when the check skipped the probe', () => {
    const src = sources([[4, profile({ spam: null })]]);
    expect(
      holds('tgNoSpam', item({ itemId: 4, telegram: telegram({ spamBlock: TG_SPAM_NONE }) }), src),
    ).toBe(true);
  });
});

describe('steamNoBan', () => {
  it('reads all four market flags', () => {
    expect(holds('steamNoBan', item({ category: 'steam', steam: steam() }))).toBe(true);
    for (const flag of ['vacBanned', 'communityBanned', 'tradeBanned', 'cs2BanActive'] as const) {
      expect(holds('steamNoBan', item({ category: 'steam', steam: steam({ [flag]: true }) }))).toBe(
        false,
      );
    }
  });

  it('answers for a hand-added account off its own check', () => {
    const local = item({ itemId: -7, category: 'steam', steam: null, scope: 'local' });
    expect(holds('steamNoBan', local, sources([], [[-7, check({ vacBanned: false })]]))).toBe(true);
    expect(holds('steamNoBan', local, sources([], [[-7, check({ vacBanned: true })]]))).toBe(false);
    expect(
      holds('steamNoBan', local, sources([], [[-7, check({ tradeBanState: 'Banned' })]])),
    ).toBe(false);
    expect(holds('steamNoBan', local, sources([], [[-7, check({ tradeBanState: 'None' })]]))).toBe(
      true,
    );
    // Nothing was asked of Steam, so nothing can be claimed.
    expect(holds('steamNoBan', local, sources([], [[-7, check({ status: 'unlinked' })]]))).toBe(
      false,
    );
    expect(holds('steamNoBan', local)).toBe(false);
  });

  // Our check sees two of the four flags.
  it('does not let a clean check overrule the market flags it cannot see', () => {
    const bought = item({ itemId: 8, category: 'steam', steam: steam({ cs2BanActive: true }) });
    const src = sources([], [[8, check({ vacBanned: false, tradeBanState: 'None' })]]);
    expect(holds('steamNoBan', bought, src)).toBe(false);
  });
});

describe('steamNotLimited', () => {
  it('reads the check first and the market second', () => {
    const local = item({ itemId: -9, category: 'steam', steam: null });
    expect(holds('steamNotLimited', local, sources([], [[-9, check({ limited: false })]]))).toBe(
      true,
    );
    expect(holds('steamNotLimited', local, sources([], [[-9, check({ limited: true })]]))).toBe(
      false,
    );
    // A private profile withholds it; the market's own field still stands.
    const bought = item({ itemId: 9, category: 'steam', steam: steam({ isLimited: false }) });
    expect(holds('steamNotLimited', bought, sources([], [[9, check({ limited: null })]]))).toBe(
      true,
    );
    expect(holds('steamNotLimited', item({ itemId: 9, category: 'steam' }))).toBe(false);
  });
});

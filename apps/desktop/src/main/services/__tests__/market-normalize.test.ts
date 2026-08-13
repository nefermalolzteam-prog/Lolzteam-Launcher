import type { RawMarketItem } from '@market-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `market.ts` reaches for Electron and the token store at import time; none of that matters to `normalizeItem`.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' } }));
vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../auth/token-store', () => ({
  loadToken: async () => null,
  onTokenChange: () => undefined,
}));
vi.mock('../api-session', () => ({ appFetch: async () => new Response('') }));

const { normalizeItem } = await import('../market');

const STEAM = 1;
const TELEGRAM = 24;
const DISCORD = 22;
const INSTAGRAM = 10;
const TIKTOK = 20;
const LLM = 6;

const item = (categoryId: number, fields: Partial<RawMarketItem>): RawMarketItem =>
  ({ item_id: 1, category_id: categoryId, ...fields }) as RawMarketItem;

describe('normalizeItem — Steam bans', () => {
  it('parses the JSON-encoded `steam_bans` blob the spec declares as a string', () => {
    const summary = normalizeItem(
      item(STEAM, {
        steam_bans: JSON.stringify({ VACBanned: false, NumberOfVACBans: 2, EconomyBan: 'none' }),
      }),
      'purchased',
    );
    expect(summary.steam?.vacCount).toBe(2);
    // The count alone is enough: the flag lies on profiles with an expired ban.
    expect(summary.steam?.vacBanned).toBe(true);
    expect(summary.steam?.tradeBanned).toBe(false);
  });

  it('accepts the same blob already parsed', () => {
    const summary = normalizeItem(
      item(STEAM, {
        steam_bans: { VACBanned: true, NumberOfVACBans: 1, EconomyBan: 'probation' },
      }),
      'purchased',
    );
    expect(summary.steam?.vacBanned).toBe(true);
    // `EconomyBan` covers the temporary trade bans `steamLifetimeTradeBan` misses.
    expect(summary.steam?.tradeBanned).toBe(true);
  });

  it('reads the lifetime trade ban and the community ban from their own fields', () => {
    const summary = normalizeItem(
      item(STEAM, { steamLifetimeTradeBan: true, steam_community_ban: 1 }),
      'purchased',
    );
    expect(summary.steam?.tradeBanned).toBe(true);
    expect(summary.steam?.communityBanned).toBe(true);
    expect(summary.steam?.vacBanned).toBe(false);
    expect(summary.steam?.vacCount).toBeNull();
  });

  it('survives a `steam_bans` string that is not JSON', () => {
    const summary = normalizeItem(item(STEAM, { steam_bans: 'not json' }), 'purchased');
    expect(summary.steam?.vacBanned).toBe(false);
    expect(summary.steam?.vacCount).toBeNull();
  });
});

describe('normalizeItem — Steam fields', () => {
  it('takes the CS2 ban state from the market, not from a date sentinel', () => {
    const active = normalizeItem(
      item(STEAM, { steam_cs2_ban_date_active: true, steam_cs2_ban_date: 1_700_000_000 }),
      'purchased',
    );
    expect(active.steam?.cs2BanActive).toBe(true);
    expect(active.steam?.cs2BanDate).toBe(1_700_000_000);

    // A date with the flag off is a ban that already expired.
    const expired = normalizeItem(item(STEAM, { steam_cs2_ban_date: 1_600_000_000 }), 'purchased');
    expect(expired.steam?.cs2BanActive).toBe(false);
    expect(expired.steam?.cs2BanDate).toBe(1_600_000_000);
  });

  it('carries the market ban end date and the Perfect World flag', () => {
    const summary = normalizeItem(
      item(STEAM, { steam_market_ban_end_date: 1_800_000_000, chineseAccount: true }),
      'purchased',
    );
    expect(summary.steam?.marketBanEndsAt).toBe(1_800_000_000);
    expect(summary.steam?.chineseAccount).toBe(true);
  });

  it('keeps the rendered balance as text and coerces the string-typed numbers', () => {
    const summary = normalizeItem(
      item(STEAM, {
        steam_balance: '0₴',
        steam_limit_spent: '3.50',
        steam_hours_played_recently: '12.4',
      }),
      'purchased',
    );
    expect(summary.steam?.balance).toBe('0₴');
    expect(summary.steam?.limitSpent).toBe(3.5);
    expect(summary.steam?.hoursRecent).toBe(12.4);
  });

  it('leaves the other services null', () => {
    const summary = normalizeItem(item(STEAM, {}), 'purchased');
    expect(summary.telegram).toBeNull();
    expect(summary.discord).toBeNull();
    expect(summary.category).toBe('steam');
  });
});

describe('normalizeItem — Telegram', () => {
  it('prefers the flat counters and falls back to the grouped object', () => {
    const summary = normalizeItem(
      item(TELEGRAM, {
        telegram_chats_count: 7,
        telegram_group_counters: { chats: 999, channels: 3, conversations: 4, admin: 2 },
      }),
      'purchased',
    );
    expect(summary.telegram?.chatsCount).toBe(7);
    expect(summary.telegram?.channelsCount).toBe(3);
    expect(summary.telegram?.conversationsCount).toBe(4);
    expect(summary.telegram?.adminCount).toBe(2);
  });

  it('treats `telegram_password` as the 0/1 flag it is', () => {
    expect(
      normalizeItem(item(TELEGRAM, { telegram_password: 1 }), 'purchased').telegram?.passwordSet,
    ).toBe(true);
    expect(
      normalizeItem(item(TELEGRAM, { telegram_password: 0 }), 'purchased').telegram?.passwordSet,
    ).toBe(false);
  });

  it('never lets a credential reach the summary', () => {
    const summary = normalizeItem(
      item(TELEGRAM, { telegram_password: 1, telegram_password_value: 'hunter2' }),
      'purchased',
    );
    expect(JSON.stringify(summary)).not.toContain('hunter2');
  });

  it('reads the admin subscriber count and the birthday', () => {
    const summary = normalizeItem(
      item(TELEGRAM, { telegram_admin_subs_count: 1234, telegram_birthday: 1_000_000 }),
      'purchased',
    );
    expect(summary.telegram?.adminSubsCount).toBe(1234);
    expect(summary.telegram?.birthday).toBe(1_000_000);
  });

  it('calls an unchecked spam block unknown rather than blocked', () => {
    const summary = normalizeItem(item(TELEGRAM, { telegram_spam_block: -1 }), 'purchased');
    expect(summary.telegram?.spamBlock).toBe(-1);
    expect(summary.telegram?.spamBlocked).toBe(false);
  });
});

describe('normalizeItem — Discord', () => {
  it('keeps the market wording for condition, locale and Nitro tier', () => {
    const summary = normalizeItem(
      item(DISCORD, {
        discord_condition: 'clear',
        discordAccountConditionLabel: 'Чистый',
        discord_locale: 'ru',
        discordLocaleTitle: 'Русский',
        discord_nitro_end_date: 1_800_000_000,
        discordNitroType: 'Nitro Basic',
      }),
      'purchased',
    );
    expect(summary.discord?.conditionLabel).toBe('Чистый');
    expect(summary.discord?.localeTitle).toBe('Русский');
    expect(summary.discord?.nitroTypeLabel).toBe('Nitro Basic');
  });

  it('drops the Nitro tier when no subscription is running', () => {
    const summary = normalizeItem(item(DISCORD, { discordNitroType: 'Nitro' }), 'purchased');
    expect(summary.discord?.nitroEndDate).toBeNull();
    expect(summary.discord?.nitroTypeLabel).toBeNull();
  });

  it('reads a zero end date as no subscription and not as the epoch', () => {
    const summary = normalizeItem(
      item(DISCORD, { discord_nitro_end_date: 0, discordNitroType: 'Нет' }),
      'purchased',
    );
    expect(summary.discord?.nitroEndDate).toBeNull();
    expect(summary.discord?.nitroTypeLabel).toBeNull();
  });

  it('reads both admin counters', () => {
    const summary = normalizeItem(
      item(DISCORD, { discord_admin_servers_count: 3, discord_admin_members_count: 15_000 }),
      'purchased',
    );
    expect(summary.discord?.adminServersCount).toBe(3);
    expect(summary.discord?.adminMembersCount).toBe(15_000);
  });
});

describe('normalizeItem — Instagram', () => {
  // The item that prompted the mapping: an autoreg, every counter at zero.
  const AUTOREG: Partial<RawMarketItem> = {
    instagram_id: 24_626_478_976,
    instagram_username: 'free.evelyn26',
    instagram_country: '',
    instagram_follower_count: 0,
    instagram_follow_count: 0,
    instagram_post_count: 0,
    instagram_register_date: 0,
    instagram_mobile: 0,
    instagram_has_cookies: 1,
    instagram_login_without_cookies: 1,
    itemOriginPhrase: 'Авторег',
  };

  it('maps the whole listing, zeroes included', () => {
    const summary = normalizeItem(item(INSTAGRAM, AUTOREG), 'purchased');
    expect(summary.category).toBe('instagram');
    expect(summary.instagram).toMatchObject({
      id: 24_626_478_976,
      username: 'free.evelyn26',
      followerCount: 0,
      followCount: 0,
      postCount: 0,
      mobile: false,
      hasCookies: true,
      loginWithoutCookies: true,
      origin: 'Авторег',
    });
    // Zero is «no followers», which is worth saying; `null` would be «the market did not say», which the card hides.
    expect(summary.instagram?.followerCount).not.toBeNull();
  });

  it('answers null for the empty country rather than a wrong flag', () => {
    expect(normalizeItem(item(INSTAGRAM, AUTOREG), 'purchased').instagram?.country).toBeNull();
  });

  it('resolves a country name the same way Steam’s is resolved', () => {
    const summary = normalizeItem(
      item(INSTAGRAM, { instagram_country: 'Russian Federation' }),
      'purchased',
    );
    expect(summary.instagram?.country).toBe('RU');
  });

  it('leaves the field null on every other category', () => {
    expect(normalizeItem(item(STEAM, AUTOREG), 'purchased').instagram).toBeNull();
  });
});

describe('normalizeItem — TikTok', () => {
  // The listing that prompted the mapping: an autoreg, every counter at zero.
  const AUTOREG: Partial<RawMarketItem> = {
    tiktok_unique_id: 'user874200784380',
    tiktok_screen_name: 'user874200784380',
    tiktok_verified: 0,
    tiktok_create_time: 1_775_805_637,
    tiktok_private_account: 0,
    tiktok_followers: 0,
    tiktok_following: 0,
    tiktok_likes: 0,
    tiktok_videos: 0,
    tiktok_has_email: 1,
    tiktok_has_mobile: 0,
    tiktok_top_country: '',
    tiktok_coins: 0,
    tiktok_can_stream: 0,
    tiktok_can_stream_studio: 0,
    itemOriginPhrase: 'Авторег',
  };

  it('maps the whole listing, zeroes included', () => {
    const summary = normalizeItem(item(TIKTOK, AUTOREG), 'purchased');
    expect(summary.category).toBe('tiktok');
    expect(summary.tiktok).toMatchObject({
      username: 'user874200784380',
      screenName: 'user874200784380',
      followerCount: 0,
      followingCount: 0,
      likeCount: 0,
      videoCount: 0,
      coins: 0,
      registerDate: 1_775_805_637,
      verified: false,
      privateAccount: false,
      hasEmail: true,
      hasMobile: false,
      canStream: false,
      origin: 'Авторег',
    });
    // Zero is «no followers», which is worth saying; `null` would be «the market did not say», which the card hides.
    expect(summary.tiktok?.followerCount).not.toBeNull();
  });

  it('answers null for the empty audience country rather than a wrong flag', () => {
    expect(normalizeItem(item(TIKTOK, AUTOREG), 'purchased').tiktok?.topCountry).toBeNull();
  });

  it('resolves an audience country name the same way Steam’s is resolved', () => {
    const summary = normalizeItem(item(TIKTOK, { tiktok_top_country: 'Netherlands' }), 'purchased');
    expect(summary.tiktok?.topCountry).toBe('NL');
  });

  it('reads the two live-stream flags apart from one another', () => {
    const summary = normalizeItem(
      item(TIKTOK, { tiktok_can_stream: 1, tiktok_can_stream_studio: 0 }),
      'purchased',
    );
    expect(summary.tiktok?.canStream).toBe(true);
    expect(summary.tiktok?.canStreamStudio).toBe(false);
  });

  it('leaves the field null on every other category', () => {
    expect(normalizeItem(item(INSTAGRAM, AUTOREG), 'purchased').tiktok).toBeNull();
  });
});

describe('normalizeItem — LLM', () => {
  // Verbatim from a live ChatGPT listing — the provider that fills the metering fields the others leave null.
  const CHATGPT: Partial<RawMarketItem> = {
    llm_service: 'chatgpt',
    llm_id: 'chatgpt_6da5f9f4-809e-4716-93b6-a47e9fa784f6',
    llm_register_date: 1_676_359_839,
    llm_subscription: 'chatgptgoplan',
    llm_subscription_ends: 1_793_796_912,
    llm_subscription_auto_renew: 1,
    llm_cookies: null,
    llm_usage_percent: null,
    llm_balance: null,
    llm_converted_balance: null,
    llm_kyc_verified: null,
    llm_phone: 0,
  };

  it('maps the plan block', () => {
    const summary = normalizeItem(item(LLM, CHATGPT), 'purchased');
    expect(summary.category).toBe('llm');
    expect(summary.llmService).toBe('chatgpt');
    expect(summary.llm).toMatchObject({
      subscription: 'chatgptgoplan',
      subscriptionEnds: 1_793_796_912,
      subscriptionAutoRenew: true,
      registerDate: 1_676_359_839,
      hasCookies: false,
      hasPhone: false,
    });
  });

  it('tells «this provider has no such check» apart from «it failed one»', () => {
    expect(normalizeItem(item(LLM, CHATGPT), 'purchased').llm?.kycVerified).toBeNull();
    expect(normalizeItem(item(LLM, { llm_kyc_verified: 0 }), 'purchased').llm?.kycVerified).toBe(
      false,
    );
    expect(normalizeItem(item(LLM, { llm_kyc_verified: 1 }), 'purchased').llm?.kycVerified).toBe(
      true,
    );
  });

  // Only ChatGPT listings ever fill `llm_phone`; on the rest the market leaves it null.
  it('reads the phone flag as the same tri-state', () => {
    expect(normalizeItem(item(LLM, { llm_phone: 0 }), 'purchased').llm?.hasPhone).toBe(false);
    expect(normalizeItem(item(LLM, { llm_phone: 1 }), 'purchased').llm?.hasPhone).toBe(true);
    expect(normalizeItem(item(LLM, { llm_phone: null }), 'purchased').llm?.hasPhone).toBeNull();
    expect(normalizeItem(item(LLM, {}), 'purchased').llm?.hasPhone).toBeNull();
  });

  it('reduces the cookie blob to a yes/no and never carries its value', () => {
    const summary = normalizeItem(
      item(LLM, { llm_cookies: [{ name: 'sessionKey', value: 'sk-ant-secret' }] }),
      'purchased',
    );
    expect(summary.llm?.hasCookies).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('sk-ant-secret');
  });

  it('treats an empty cookie payload as no cookies', () => {
    expect(normalizeItem(item(LLM, { llm_cookies: '' }), 'purchased').llm?.hasCookies).toBe(false);
    expect(normalizeItem(item(LLM, { llm_cookies: [] }), 'purchased').llm?.hasCookies).toBe(false);
    expect(normalizeItem(item(LLM, { llm_cookies: {} }), 'purchased').llm?.hasCookies).toBe(false);
  });

  it('keeps the rendered balance as text and the usage share as a number', () => {
    const summary = normalizeItem(
      item(LLM, { llm_balance: '12.34$', llm_converted_balance: '1100', llm_usage_percent: '82' }),
      'purchased',
    );
    expect(summary.llm?.balance).toBe('12.34$');
    expect(summary.llm?.convertedBalance).toBe(1100);
    expect(summary.llm?.usagePercent).toBe(82);
  });

  it('leaves the field null on every other category', () => {
    expect(normalizeItem(item(STEAM, CHATGPT), 'purchased').llm).toBeNull();
  });
});

describe('normalizeItem — common fields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports an unknown category instead of guessing one', () => {
    const summary = normalizeItem(item(9999, { title: 'Something else' }), 'purchased');
    expect(summary.category).toBeNull();
    expect(summary.steam).toBeNull();
  });

  it('maps tags, warranty and the purchase date', () => {
    const summary = normalizeItem(
      item(STEAM, {
        tags: { '0': { tag_id: 2, title: 'Невалид', bc: 'red' } },
        warranty_end_at: 1_800_000_000,
        buyer: { operation_date: 1_700_000_000 },
        item_state: 'paid',
      }),
      'purchased',
    );
    expect(summary.tags).toEqual([{ id: 2, title: 'Невалид', bc: 'red' }]);
    expect(summary.warrantyEndsAt).toBe(1_800_000_000);
    expect(summary.purchasedAt).toBe(1_700_000_000);
    expect(summary.isPurchased).toBe(true);
  });
});

import { MarketClient, readRateLimit } from '@market-sdk';
import type {
  RateLimitInfo,
  RawLetter,
  RawMarketItem,
  RawOrdersResponse,
  RawProfileResponse,
  RawUserTag,
} from '@market-sdk';
import {
  categoryIdToServiceId,
  categoryNameToServiceId,
  detectLlmService,
  isProxyHost,
} from '@shared-types';
import type {
  AccountDetails,
  AccountSummary,
  AccountTag,
  AuthSession,
  DiscordInfo,
  InstagramInfo,
  LlmInfo,
  MailLetter,
  MailLettersRequest,
  MailLettersResult,
  MarketScope,
  ServiceId,
  SteamGame,
  SteamInfo,
  TelegramInfo,
  TikTokInfo,
  UserLabel,
} from '@shared-types';
import { app } from 'electron';
import log from 'electron-log/main';
import { type MafileData, parseMafile } from '../adapters/steam/mafile';
import { loadToken, onTokenChange } from '../auth/token-store';
import { sleep } from '../lib/sleep';
import { appFetch } from './api-session';
import { toIsoCountry } from './country';

let client: MarketClient | null = null;

const getClient = (): MarketClient => {
  if (!client) {
    client = new MarketClient({
      getToken: () => loadToken(),
      userAgent: `LolzteamLauncher/${app.getVersion?.() ?? '0.0.0'} (+desktop)`,
      fetch: appFetch,
    });
  }
  return client;
};

// Bumped on every token change (login/logout).
let tokenEpoch = 0;

onTokenChange(() => {
  client = null;
  tokenEpoch += 1;
});

const pickAvatarUrl = (user: RawProfileResponse['user']): string | null =>
  user.rendered?.avatars?.l ??
  user.rendered?.avatars?.m ??
  user.rendered?.avatars?.s ??
  user.links?.avatar_big ??
  user.links?.avatar ??
  user.avatar_url ??
  null;

const pickUsernameHtml = (user: RawProfileResponse['user']): string | null => {
  const html = user.rendered?.username;
  return typeof html === 'string' && html.trim() ? html : null;
};

const parseBalance = (value: number | string | undefined): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const normalizeProfile = (raw: RawProfileResponse): AuthSession => ({
  userId: raw.user.user_id,
  username: raw.user.username,
  usernameHtml: pickUsernameHtml(raw.user),
  avatarUrl: pickAvatarUrl(raw.user),
  profileUrl: raw.user.view_url ?? raw.user.links?.permalink ?? null,
  // `convertedBalance` is the spendable balance already in the selected currency.
  balance: parseBalance(raw.user.convertedBalance ?? raw.user.balance),
  // Forum API gives a lowercase code ("rub"); uppercase it for display/Intl.
  currency: typeof raw.user.currency === 'string' ? raw.user.currency.toUpperCase() : null,
});

export const fetchProfile = async (): Promise<AuthSession | null> => {
  const result = await fetchProfileResult();
  return result.kind === 'ok' ? result.session : null;
};

export type ProfileResult =
  | { kind: 'ok'; session: AuthSession }
  | { kind: 'offline' }
  | { kind: 'unauthorized' };

const httpStatusOf = (err: unknown): number | null => {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { status?: number } }).response;
    if (res && typeof res.status === 'number') return res.status;
  }
  return null;
};

const isAuthRejection = (err: unknown): boolean => {
  const status = httpStatusOf(err);
  return status === 401 || status === 403;
};

const isAbortError = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));

/** Whose profile does this client see? */
const profileVia = async (client: MarketClient): Promise<ProfileResult> => {
  // Market `/me` returns rendered avatars + gradient username HTML + balance in one call.
  try {
    const raw = await client.me();
    if (raw?.user) return { kind: 'ok', session: normalizeProfile(raw) };
    log.warn('[market] me() returned no user; falling back to forum profile');
  } catch (err) {
    if (isAuthRejection(err)) return { kind: 'unauthorized' };
    log.warn('[market] me() failed; falling back to forum profile', err);
  }
  try {
    const raw = await client.meForum();
    if (raw?.user) return { kind: 'ok', session: normalizeProfile(raw) };
  } catch (err) {
    if (isAuthRejection(err)) return { kind: 'unauthorized' };
    log.warn('[market] fetchProfile fallback failed', err);
  }
  return { kind: 'offline' };
};

export const fetchProfileResult = async (): Promise<ProfileResult> => {
  const token = await loadToken();
  if (!token) return { kind: 'unauthorized' };
  return profileVia(getClient());
};

/** Ask the market who a token belongs to, without adopting it. */
export const probeToken = async (token: string): Promise<ProfileResult> => {
  const candidate = token.trim();
  if (!candidate) return { kind: 'unauthorized' };
  return profileVia(
    new MarketClient({
      getToken: () => candidate,
      userAgent: `LolzteamLauncher/${app.getVersion?.() ?? '0.0.0'} (+desktop)`,
      fetch: appFetch,
    }),
  );
};

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// XenForo flags arrive as 0/1 ints (sometimes strings).
const asFlag = (v: unknown): boolean => {
  const n = asNumber(v);
  return n !== null && n !== 0;
};

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const extractTags = (item: RawMarketItem): AccountTag[] => {
  const tags = item.tags;
  if (!tags || typeof tags !== 'object') return [];
  const out: AccountTag[] = [];
  for (const entry of Object.values(tags as Record<string, unknown>)) {
    if (entry && typeof entry === 'object') {
      const id = asNumber((entry as { tag_id?: unknown }).tag_id);
      const title = asString((entry as { title?: unknown }).title)?.trim();
      const bc = asString((entry as { bc?: unknown }).bc)?.trim();
      if (id !== null && title) out.push(bc ? { id, title, bc } : { id, title });
    }
  }
  return out;
};

interface SteamBans {
  vacBanned: boolean;
  communityBanned: boolean;
  tradeBanned: boolean;
  /** How many VAC bans the profile carries; null when the field is absent. */
  vacCount: number | null;
}

/** `steam_bans` is Steam's own `GetPlayerBans` payload. */
const parseSteamBans = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const extractSteamBans = (item: RawMarketItem): SteamBans => {
  const obj = parseSteamBans(item.steam_bans);

  const vacCount = obj ? asNumber(obj.NumberOfVACBans) : null;
  const vacBanned = obj ? asFlag(obj.VACBanned) || (vacCount ?? 0) > 0 : false;

  // `steam_community_ban` is the market's own documented flag; the bans blob repeats it, and either one being set is enough.
  const communityBanned =
    asFlag(item.steam_community_ban) || (obj ? asFlag(obj.CommunityBanned) : false);

  // `steamLifetimeTradeBan` is documented as a plain boolean.
  const economyBan = obj ? asString(obj.EconomyBan) : null;
  const tradeBanned =
    item.steamLifetimeTradeBan === true || (economyBan !== null && economyBan !== 'none');

  return { vacBanned, communityBanned, tradeBanned, vacCount };
};

const RESOLD_TAG_TITLES = new Set(['перепродан', 'resold']);

const isResold = (item: RawMarketItem): boolean =>
  extractTags(item).some((tag) => RESOLD_TAG_TITLES.has(tag.title.trim().toLowerCase()));

// Top games by hours played.
const extractSteamGames = (item: RawMarketItem, max = 6): SteamGame[] => {
  const full = item.steam_full_games;
  const list = full && typeof full === 'object' ? (full as { list?: unknown }).list : null;
  if (!list || typeof list !== 'object') return [];
  const games: SteamGame[] = [];
  for (const raw of Object.values(list as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    const appId = asNumber(g.appid);
    const parentGameId = asNumber(g.parentGameId) ?? appId;
    const title = asString(g.abbr) ?? asString(g.title);
    if (appId === null || parentGameId === null || !title) continue;
    games.push({
      appId,
      parentGameId,
      title,
      hours: asNumber(g.playtime_forever) ?? 0,
    });
  }
  games.sort((a, b) => b.hours - a.hours);
  return games.slice(0, max);
};

// Steam items expose a rich set of `steam_*` fields plus `tags`/origin.
const extractSteamInfo = (item: RawMarketItem, serviceId: ServiceId | null): SteamInfo | null => {
  if (serviceId !== 'steam') return null;
  const bans = extractSteamBans(item);
  return {
    tags: extractTags(item),
    level: asNumber(item.steam_level),
    gameCount: asNumber(item.steam_game_count),
    isLimited: asFlag(item.steam_is_limited),
    lastActivity: asNumber(item.steam_last_activity),
    vacBanned: bans.vacBanned,
    communityBanned: bans.communityBanned,
    tradeBanned: bans.tradeBanned,
    balance: asString(item.steam_balance),
    origin: asString(item.itemOriginPhrase),
    country: toIsoCountry(item.steam_country),
    games: extractSteamGames(item),
    vacCount: bans.vacCount,
    // Whether the CS2 ban is still running is the market's own call.
    cs2BanActive: item.steam_cs2_ban_date_active === true,
    cs2BanDate: asNumber(item.steam_cs2_ban_date),
    marketBanEndsAt: asNumber(item.steam_market_ban_end_date),
    chineseAccount: item.chineseAccount === true,
    limitSpent: asNumber(item.steam_limit_spent),
    convertedBalance: asNumber(item.steam_converted_balance),
    inventoryValue: asNumber(item.steam_inv_value),
    hoursRecent: asNumber(item.steam_hours_played_recently),
    lastTransaction: asNumber(item.steam_last_transaction_date),
    registerDate: asNumber(item.steam_register_date),
    points: asNumber(item.steam_points),
    friendCount: asNumber(item.steam_friend_count),
    faceitLevel: asNumber(item.steam_faceit_level),
    giftCount: asNumber(item.steam_gift_count),
  };
};

const extractTelegramInfo = (
  item: RawMarketItem,
  serviceId: ServiceId | null,
): TelegramInfo | null => {
  if (serviceId !== 'telegram') return null;
  const spamBlock = asNumber(item.telegram_spam_block);
  // The spec ships both a flat `*_count` per kind and one grouped object; older items only carry the group.
  const groups = item.telegram_group_counters ?? null;
  return {
    // Detail-only fields (see `TelegramInfo`): never present on a listing.
    phone: asString(item.telegram_phone),
    username: asString(item.telegram_username),
    id: asNumber(item.telegram_id),
    country: asString(item.telegram_country),
    lastSeen: asNumber(item.telegram_last_seen),
    premium: asFlag(item.telegram_premium),
    premiumExpires: asNumber(item.telegram_premium_expires),
    // -1 means "unknown/not checked"; anything > 0 is an active block.
    spamBlocked: (spamBlock ?? -1) > 0,
    spamBlock,
    tags: extractTags(item),
    origin: asString(item.itemOriginPhrase),
    channelsCount: asNumber(item.telegram_channels_count) ?? asNumber(groups?.channels),
    chatsCount: asNumber(item.telegram_chats_count) ?? asNumber(groups?.chats),
    contactsCount: asNumber(item.telegram_contacts_count),
    conversationsCount:
      asNumber(item.telegram_conversations_count) ?? asNumber(groups?.conversations),
    adminCount: asNumber(item.telegram_admin_count) ?? asNumber(groups?.admin),
    adminSubsCount: asNumber(item.telegram_admin_subs_count),
    starsCount: asNumber(item.telegram_stars_count),
    birthday: asNumber(item.telegram_birthday),
    // `telegram_password` is a 0/1 flag and never the password itself.
    passwordSet: asFlag(item.telegram_password),
  };
};

const extractDiscordInfo = (
  item: RawMarketItem,
  serviceId: ServiceId | null,
): DiscordInfo | null => {
  if (serviceId !== 'discord') return null;
  // An account with no subscription arrives as `0`, not as an absent field — the market's own `getNitroInfo()` returns.
  const nitroEnd = asNumber(item.discord_nitro_end_date);
  const nitroEndDate = nitroEnd !== null && nitroEnd > 0 ? nitroEnd : null;
  return {
    tags: extractTags(item),
    origin: asString(item.itemOriginPhrase),
    locale: asString(item.discord_locale),
    localeTitle: asString(item.discordLocaleTitle),
    verified: asFlag(item.discord_verified),
    condition: asString(item.discord_condition),
    conditionLabel: asString(item.discordAccountConditionLabel),
    billing: asFlag(item.discord_billing),
    gifts: asNumber(item.discord_gifts),
    registerDate: asNumber(item.discord_register_date),
    chatCount: asNumber(item.discord_chat_count),
    adminServersCount: asNumber(item.discord_admin_servers_count),
    adminMembersCount: asNumber(item.discord_admin_members_count),
    // The tier already arrives spelled out; `discord_nitro_type` is the numeric twin of it and only means anything while.
    nitroTypeLabel: nitroEndDate === null ? null : asString(item.discordNitroType),
    nitroEndDate,
    boosts: asNumber(item.discord_available_boosts),
  };
};

const extractInstagramInfo = (
  item: RawMarketItem,
  serviceId: ServiceId | null,
): InstagramInfo | null => {
  if (serviceId !== 'instagram') return null;
  return {
    tags: extractTags(item),
    origin: asString(item.itemOriginPhrase),
    id: asNumber(item.instagram_id),
    username: asString(item.instagram_username),
    // Unlike `telegram_country`, this one is a name when it is anything at all.
    country: toIsoCountry(item.instagram_country),
    followerCount: asNumber(item.instagram_follower_count),
    followCount: asNumber(item.instagram_follow_count),
    postCount: asNumber(item.instagram_post_count),
    registerDate: asNumber(item.instagram_register_date),
    mobile: asFlag(item.instagram_mobile),
    hasCookies: asFlag(item.instagram_has_cookies),
    loginWithoutCookies: asFlag(item.instagram_login_without_cookies),
  };
};

const extractTikTokInfo = (item: RawMarketItem, serviceId: ServiceId | null): TikTokInfo | null => {
  if (serviceId !== 'tiktok') return null;
  return {
    tags: extractTags(item),
    origin: asString(item.itemOriginPhrase),
    username: asString(item.tiktok_unique_id),
    screenName: asString(item.tiktok_screen_name),
    // A name when set and "" when not — the same two dialects `country.ts` exists.
    topCountry: toIsoCountry(item.tiktok_top_country),
    followerCount: asNumber(item.tiktok_followers),
    followingCount: asNumber(item.tiktok_following),
    likeCount: asNumber(item.tiktok_likes),
    videoCount: asNumber(item.tiktok_videos),
    coins: asNumber(item.tiktok_coins),
    registerDate: asNumber(item.tiktok_create_time),
    verified: asFlag(item.tiktok_verified),
    privateAccount: asFlag(item.tiktok_private_account),
    hasEmail: asFlag(item.tiktok_has_email),
    hasMobile: asFlag(item.tiktok_has_mobile),
    canStream: asFlag(item.tiktok_can_stream),
    canStreamStudio: asFlag(item.tiktok_can_stream_studio),
  };
};

/** A three-state flag: `null` when the market said nothing at all. */
const asTriFlag = (v: unknown): boolean | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v;
  const n = asNumber(v);
  return n === null ? null : n !== 0;
};

/** "Did the market send anything here?" for fields whose *value* must not be read — see `extractLlmInfo` and `llm_cookies`. */
const hasPayload = (v: unknown): boolean => {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
};

/** LLM items, mapped from `llm_*`. */
const extractLlmInfo = (item: RawMarketItem, serviceId: ServiceId | null): LlmInfo | null => {
  if (serviceId !== 'llm') return null;
  return {
    subscription: asString(item.llm_subscription),
    subscriptionEnds: asNumber(item.llm_subscription_ends),
    subscriptionAutoRenew: asFlag(item.llm_subscription_auto_renew),
    registerDate: asNumber(item.llm_register_date),
    hasCookies: hasPayload(item.llm_cookies),
    usagePercent: asNumber(item.llm_usage_percent),
    balance: asString(item.llm_balance),
    convertedBalance: asNumber(item.llm_converted_balance),
    kycVerified: asTriFlag(item.llm_kyc_verified),
    hasPhone: asTriFlag(item.llm_phone),
  };
};

// `buyer.operation_date` (when present) is when the current viewer purchased the item.
const extractPurchasedAt = (item: RawMarketItem): number | null => {
  const buyer = item.buyer;
  if (buyer && typeof buyer === 'object') {
    const date = asNumber((buyer as { operation_date?: unknown }).operation_date);
    if (date) return date;
  }
  return null;
};

const pickCategoryRaw = (item: RawMarketItem): string => {
  const cat = item.category;
  return (cat?.name ?? cat?.category_name ?? item.category_name ?? '').toString();
};

const pickCategoryTitle = (item: RawMarketItem): string => {
  const cat = item.category;
  return (
    cat?.title ??
    cat?.category_title ??
    item.category_title ??
    pickCategoryRaw(item) ??
    'Unknown'
  ).toString();
};

/** Market categories we could not map to a `ServiceId`. */
const unmappedCategories = new Set<string>();

const REGISTRY_HINT =
  'Accounts of this category stay hidden. Add an entry (or an alias) in packages/shared-types/src/service-registry.ts.';

const reportUnmappedCategory = (item: RawMarketItem, categoryRaw: string): void => {
  const key = `${categoryRaw || '?'}#${item.category_id ?? '?'}`;
  if (unmappedCategories.has(key)) return;
  unmappedCategories.add(key);
  const where = `category_id=${item.category_id ?? 'none'}, item ${item.item_id}`;
  log.warn(`[market] unknown category "${categoryRaw}" (${where}) — ${REGISTRY_HINT}`);
};

/** Raw market item → `AccountSummary`. */
export const normalizeItem = (item: RawMarketItem, scope: MarketScope): AccountSummary => {
  const categoryRaw = pickCategoryRaw(item);
  // Resolve by name first; fall back to the numeric category id so a category with an unexpected name string.
  const category = categoryNameToServiceId(categoryRaw) ?? categoryIdToServiceId(item.category_id);
  if (category === null) reportUnmappedCategory(item, categoryRaw);
  return {
    itemId: item.item_id,
    category,
    categoryRaw,
    categoryTitle: pickCategoryTitle(item),
    title: item.title ?? item.title_en ?? `#${item.item_id}`,
    description: item.description ?? '',
    price: item.price ?? 0,
    currency: item.price_currency ?? 'RUB',
    imageUrl: item.item_image_url ?? item.item_image ?? null,
    tags: extractTags(item),
    warrantyEndsAt: item.warranty_end_at ?? null,
    publishedAt: item.published_date ?? null,
    purchasedAt: extractPurchasedAt(item),
    isPurchased: item.item_state === 'paid' || item.item_state === 'closed',
    scope,
    steam: extractSteamInfo(item, category),
    telegram: extractTelegramInfo(item, category),
    discord: extractDiscordInfo(item, category),
    instagram: extractInstagramInfo(item, category),
    tiktok: extractTikTokInfo(item, category),
    llmService:
      category === 'llm'
        ? detectLlmService(
            typeof item.llm_service === 'string' ? item.llm_service : null,
            item.title,
            item.title_en,
            item.description,
          )
        : null,
    llm: extractLlmInfo(item, category),
    hasEmailLogin: Boolean(
      item.emailLoginData?.login ||
        item.email_login_data?.login ||
        item.canViewEmailLoginData ||
        item.can_view_email_login_data,
    ),
    // Only Steam has a maFile to speak of; `null` for every other category so the card can tell "no maFile" apart from "the.
    hasMafile: category === 'steam' ? asFlag(item.steam_mfa) : null,
    // Whatever the user wrote about this account on the market.
    note: asString(item.note_text),
    // A market item lives on lzt.market, not in the local base.
    folder: null,
    // A market item is never itself a copy of something.
    marketItemId: null,
    // Filled in by whoever assembles the list — the market knows nothing about the local base.
    localCopyId: null,
  };
};

type PageProgress = { page: number; totalPages: number | null };
type OnPage = (items: AccountSummary[], progress: PageProgress) => void;

/** The result of walking a paginated list. */
export interface MarketList {
  readonly items: AccountSummary[];
  readonly complete: boolean;
}

/** The runaway guard, and nothing else. */
const MAX_PAGES = 1000;

/** Pages of slack past the total the server reported. */
const PAGE_SLACK = 3;

/** How much of the rate-limit window we refuse to spend. */
const PACE_FLOOR = 2;

/** Same reasoning as the client's cap: the window is one minute, no more. */
const MAX_PACE_WAIT_MS = 70_000;

/** Waits out the rate-limit window when the current one is nearly spent. */
const pace = async (info: RateLimitInfo | null, signal?: AbortSignal): Promise<void> => {
  if (info === null || info.remaining > PACE_FLOOR) return;
  const ms = Math.min(info.reset * 1000 - Date.now(), MAX_PACE_WAIT_MS);
  if (ms <= 0) return;
  log.info(`[market] rate limit nearly spent (${info.remaining}/${info.limit}); pausing ${ms}ms`);
  await sleep(ms, signal);
};

// 'purchased' reads the user's orders; 'listed' reads their own active listings.
const fetchPage = (scope: MarketScope, page: number, categoryId?: number, signal?: AbortSignal) =>
  scope === 'listed'
    ? getClient().listUser({ page, categoryId, show: 'active' }, signal)
    : getClient().listOrders({ page, categoryId }, signal);

const paginate = async (
  scope: MarketScope,
  categoryId?: number,
  onPage?: OnPage,
  signal?: AbortSignal,
): Promise<MarketList> => {
  const epoch = tokenEpoch;
  const out: AccountSummary[] = [];
  let page = 1;
  let hasNext = true;
  // Recomputed from every response rather than pinned on the first, so a list that grows mid-walk raises the bound with it.
  let bound = MAX_PAGES;
  const where = `scope=${scope}, category=${categoryId ?? 'all'}`;
  while (hasNext && page <= bound) {
    if (tokenEpoch !== epoch || signal?.aborted) return { items: out, complete: false };
    let resp: RawOrdersResponse;
    try {
      resp = await fetchPage(scope, page, categoryId, signal);
    } catch (err) {
      if (!isAbortError(err) && !signal?.aborted) {
        log.warn(`[market] page ${page} failed (${where})`, err);
      }
      return { items: out, complete: false };
    }
    const items = resp.items ?? [];
    // Resold items only appear among purchases; own listings are kept as-is.
    const visible = scope === 'listed' ? items : items.filter((it) => !isResold(it));
    const normalized = visible.map((it) => normalizeItem(it, scope));
    out.push(...normalized);
    const perPage = resp.perPage || items.length;
    const totalPages =
      perPage > 0 && resp.totalItems > 0 ? Math.ceil(resp.totalItems / perPage) : null;
    if (totalPages !== null) bound = Math.min(totalPages + PAGE_SLACK, MAX_PAGES);
    onPage?.(normalized, { page, totalPages });
    if (typeof resp.hasNextPage === 'boolean') {
      hasNext = resp.hasNextPage;
    } else {
      hasNext = items.length > 0 && perPage > 0 && page * perPage < resp.totalItems;
    }
    page += 1;
    if (hasNext && page <= bound) await pace(readRateLimit(resp), signal);
  }
  if (hasNext) {
    log.warn(
      `[market] pagination stopped at the ${page - 1}-page guard (${where}) — the list is incomplete`,
    );
  }
  return { items: out, complete: !hasNext };
};

/** Both walks answer with what they managed to collect. */
export const listPurchasedAccounts = async (
  scope: MarketScope = 'purchased',
  signal?: AbortSignal,
): Promise<MarketList> => {
  const token = await loadToken();
  if (!token) return { items: [], complete: false };
  return paginate(scope, undefined, undefined, signal);
};

export const listAccountsByCategory = async (
  categoryId: number,
  scope: MarketScope = 'purchased',
  onPage?: OnPage,
  signal?: AbortSignal,
): Promise<MarketList> => {
  const token = await loadToken();
  if (!token) return { items: [], complete: false };
  return paginate(scope, categoryId, onPage, signal);
};

/** Waits for the market to parse the confirmation code out of the mailbox. */
export const fetchEmailCode = async (
  itemId: number,
  signal: AbortSignal,
): Promise<string | null> => {
  const token = await loadToken();
  if (!token) return null;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (signal.aborted) return null;
    try {
      const resp = await getClient().getEmailCode(itemId, signal);
      if ('codeData' in resp && resp.codeData && typeof resp.codeData.code === 'string') {
        const code = resp.codeData.code.trim();
        if (code) return code;
      }
      const err = (resp as { error?: string }).error;
      if (err && err !== 'retry_request') {
        log.warn(`[market] getEmailCode returned error: ${err}`);
        return null;
      }
    } catch (err) {
      log.warn('[market] getEmailCode threw', err);
      return null;
    }
    await sleep(2000, signal);
  }
  return null;
};

// Tag id 1 marks a "valid" account; only the invalid tag is checked below.
const INVALID_TAG_ID = 2;

export type CheckAccountResult =
  | { ok: true; valid: boolean; tags: AccountTag[]; reason?: string }
  | { ok: false; message: string };

const tagsToResult = (tags: AccountTag[], reason?: string): CheckAccountResult => {
  const valid = !tags.some((tag) => tag.id === INVALID_TAG_ID);
  return { ok: true, valid, tags, reason };
};

const fetchAuthoritativeTags = async (
  itemId: number,
  signal?: AbortSignal,
): Promise<AccountTag[] | null> => {
  try {
    const resp = await getClient().getItem(itemId, signal);
    if (resp?.item) return extractTags(resp.item);
  } catch (err) {
    log.warn(`[market] checkAccount getItem(${itemId}) failed`, err);
  }
  return null;
};

/** Asks the market to re-check the account and reports what it decided. */
export const checkAccountValidity = async (
  itemId: number,
  signal?: AbortSignal,
): Promise<CheckAccountResult> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  for (let attempt = 0; attempt < 100; attempt++) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' };
    try {
      const resp = await getClient().checkAccount(itemId, signal);
      const errors = 'errors' in resp && Array.isArray(resp.errors) ? resp.errors : [];
      if (errors.includes('retry_request')) {
        await sleep(2000, signal);
        continue;
      }
      const reason = typeof errors[0] === 'string' ? errors[0] : undefined;
      if (reason) log.warn(`[market] checkAccount(${itemId}) error: ${reason}`);
      const tags = await fetchAuthoritativeTags(itemId, signal);
      if (tags) return tagsToResult(tags, reason);
      return { ok: false, message: reason ?? 'check_failed' };
    } catch (err) {
      log.warn(`[market] checkAccount(${itemId}) threw`, err);
      return { ok: false, message: err instanceof Error ? err.message : 'check_failed' };
    }
  }
  return { ok: false, message: 'retry_request' };
};

/** The whole maFile, not just the login secret. */
export const fetchSteamMafileData = async (
  itemId: number,
  signal?: AbortSignal,
): Promise<MafileData | null> => {
  const token = await loadToken();
  if (!token) return null;
  try {
    const resp = await getClient().getSteamMafile(itemId, signal);
    return parseMafile(resp);
  } catch (err) {
    log.warn('[market] getSteamMafile failed', err);
    return null;
  }
};

/** The login path only ever wants the TOTP secret; kept narrow for the adapter contract. */
export const fetchSteamMafile = async (
  itemId: number,
  signal?: AbortSignal,
): Promise<string | null> => (await fetchSteamMafileData(itemId, signal))?.sharedSecret ?? null;

const asTrimmedString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** `loginData.{login,password}` is the documented credential carrier and is preferred everywhere except Telegram. */
const pickLoginRaw = (item: RawMarketItem, serviceId: ServiceId | null): string | null => {
  if (serviceId === 'telegram') return asTrimmedString(item.telegram_phone);

  const ld = item.loginData;
  const fromLoginData =
    ld && typeof ld === 'object' ? asTrimmedString((ld as { login?: unknown }).login) : null;
  return fromLoginData ?? asTrimmedString(item.account_login);
};

const pickPasswordRaw = (item: RawMarketItem, serviceId: ServiceId | null): string | null => {
  if (serviceId === 'telegram') return asTrimmedString(item.telegram_password_value);

  const ld = item.loginData;
  const fromLoginData =
    ld && typeof ld === 'object' ? asTrimmedString((ld as { password?: unknown }).password) : null;
  return fromLoginData ?? asTrimmedString(item.account_password);
};

/** Why an item's details could not be had. */
export type AccountDetailsResult =
  | { ok: true; details: AccountDetails }
  | { ok: false; reason: 'not_found' | 'unreachable'; detail?: string };

export const fetchAccountDetails = async (
  itemId: number,
  signal?: AbortSignal,
): Promise<AccountDetailsResult> => {
  let resp: { item?: RawMarketItem };
  try {
    resp = await getClient().getItem(itemId, signal);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn(`[market] getItem(${itemId}) unreachable: ${detail}`);
    return { ok: false, reason: 'unreachable', detail };
  }

  try {
    const item = resp.item;
    if (!item) return { ok: false, reason: 'not_found' };
    // Scope is irrelevant for a single item's login flow; default to 'purchased'.
    const summary = normalizeItem(item, 'purchased');
    const loginRaw = pickLoginRaw(item, summary.category);
    const passwordRaw = pickPasswordRaw(item, summary.category);
    // Ownership uses the market's own authoritative flags, NOT credential presence (which varies by category and state).
    const anyItem = item as unknown as Record<string, unknown>;
    const buyer = anyItem.buyer as { visitorIsBuyer?: boolean } | null | undefined;
    const owned = buyer?.visitorIsBuyer === true || anyItem.visitorIsAuthor === true;
    log.debug(
      `[market] item #${itemId} category=${summary.categoryRaw} owned=${owned} ` +
        `loginRaw=${loginRaw ? 'present' : 'missing'} ` +
        `passwordRaw=${passwordRaw ? 'present' : 'missing'}`,
    );
    return {
      ok: true,
      details: {
        ...summary,
        loginRaw,
        passwordRaw,
        secrets: item,
        owned,
      },
    };
  } catch (err) {
    // Reading a shape the market changed under us.
    const detail = err instanceof Error ? err.message : String(err);
    log.warn(`[market] getItem(${itemId}) could not be read: ${detail}`);
    return { ok: false, reason: 'unreachable', detail };
  }
};

/** The same thing for callers that can do nothing with the difference. */
export const getAccountDetails = async (
  itemId: number,
  signal?: AbortSignal,
): Promise<AccountDetails | null> => {
  const result = await fetchAccountDetails(itemId, signal);
  return result.ok ? result.details : null;
};

// --- User labels (метки) -----------------------------------------------------
let labelsCache: UserLabel[] | null = null;

onTokenChange(() => {
  labelsCache = null;
});

const mapUserTags = (tags: RawUserTag[] | undefined): UserLabel[] => {
  const out: UserLabel[] = [];
  for (const t of tags ?? []) {
    const id = asNumber(t?.tag_id);
    const title = asString(t?.title)?.trim();
    if (id === null || !title) continue;
    out.push({
      id,
      title,
      bc: asString(t?.bc)?.trim() ?? '',
      isDefault: t?.isDefault === true,
      forOwnedAccountsOnly: t?.forOwnedAccountsOnly === true,
    });
  }
  return out;
};

const normalizeLabels = (raw: RawProfileResponse): UserLabel[] =>
  mapUserTags(raw.user.tags as RawUserTag[] | undefined);

export const listUserLabels = async (opts?: { refresh?: boolean }): Promise<UserLabel[]> => {
  if (!opts?.refresh && labelsCache) return labelsCache;
  const token = await loadToken();
  if (!token) return [];
  try {
    const raw = await getClient().me();
    if (raw?.user) {
      labelsCache = normalizeLabels(raw);
      return labelsCache;
    }
  } catch (err) {
    log.warn('[market] listUserLabels failed', err);
  }
  return labelsCache ?? [];
};

const tagOpError = (resp: { errors?: string[] | string }): string | null => {
  const e = resp.errors;
  if (Array.isArray(e) && e.length > 0 && typeof e[0] === 'string') return e[0];
  if (typeof e === 'string' && e) return e;
  return null;
};

export type LabelResult = { ok: true; labels: UserLabel[] } | { ok: false; message: string };

const refreshUserTags = async (): Promise<UserLabel[]> => {
  const resp = await getClient().getUserTags();
  if (tagOpError(resp) || !Array.isArray(resp.tags)) return labelsCache ?? [];
  labelsCache = mapUserTags(resp.tags);
  return labelsCache;
};

const runLabelMutation = async (
  op: () => Promise<{ errors?: string[] | string }>,
  what: string,
): Promise<LabelResult> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  let resp: { errors?: string[] | string };
  try {
    resp = await op();
  } catch (err) {
    log.warn(`[market] ${what} failed`, err);
    return { ok: false, message: err instanceof Error ? err.message : 'label_failed' };
  }
  const err = tagOpError(resp);
  if (err) return { ok: false, message: err };
  try {
    return { ok: true, labels: await refreshUserTags() };
  } catch (refreshErr) {
    log.warn(`[market] ${what} refresh failed (mutation ok)`, refreshErr);
    return { ok: true, labels: labelsCache ?? [] };
  }
};

export const createLabel = (title: string, bc: string): Promise<LabelResult> =>
  runLabelMutation(() => getClient().createUserTag(title, bc), 'createLabel');

export const updateLabel = (tagId: number, title: string, bc: string): Promise<LabelResult> =>
  runLabelMutation(() => getClient().updateUserTag(tagId, title, bc), 'updateLabel');

export const deleteLabel = (tagId: number): Promise<LabelResult> =>
  runLabelMutation(() => getClient().deleteUserTag(tagId), 'deleteLabel');

export const reorderLabels = async (tagIds: number[]): Promise<LabelResult> => {
  const known = (labelsCache ?? (await listUserLabels())).map((l) => l.id);
  const seen = new Set(tagIds);
  const full = [...tagIds, ...known.filter((id) => !seen.has(id))];
  return runLabelMutation(() => getClient().reorderUserTags(full), 'reorderLabels');
};

export const addItemTag = async (
  itemId: number,
  tagId: number,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  try {
    const resp = await getClient().addItemTag(itemId, tagId);
    const err = tagOpError(resp);
    if (err) return { ok: false, message: err };
    return { ok: true };
  } catch (err) {
    log.warn(`[market] addItemTag(${itemId}, ${tagId}) failed`, err);
    return { ok: false, message: err instanceof Error ? err.message : 'tag_failed' };
  }
};

export const removeItemTag = async (
  itemId: number,
  tagId: number,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  try {
    const resp = await getClient().removeItemTag(itemId, tagId);
    const err = tagOpError(resp);
    if (err) return { ok: false, message: err };
    return { ok: true };
  } catch (err) {
    log.warn(`[market] removeItemTag(${itemId}, ${tagId}) failed`, err);
    return { ok: false, message: err instanceof Error ? err.message : 'tag_failed' };
  }
};

// --- Account note ------------------------------------------------------------

/** The longest note we will send. */
const NOTE_MAX_LENGTH = 1000;

/** Write the account's note, or delete it when the text comes back empty. */
export const setAccountNote = async (
  itemId: number,
  text: string,
): Promise<{ ok: true; note: string | null } | { ok: false; message: string }> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  const note = text.trim().slice(0, NOTE_MAX_LENGTH).trim();
  try {
    const client = getClient();
    const resp = note
      ? await client.setItemNote(itemId, note)
      : await client.deleteItemNote(itemId);
    const err = tagOpError(resp);
    if (err) return { ok: false, message: err };
    return { ok: true, note: note || null };
  } catch (err) {
    log.warn(`[market] setAccountNote(${itemId}) failed`, err);
    return { ok: false, message: err instanceof Error ? err.message : 'note_failed' };
  }
};

// --- Account currency --------------------------------------------------------

export const setCurrency = async (
  currency: string,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  try {
    const resp = await getClient().updateCurrency(currency);
    const err = tagOpError(resp);
    if (err) return { ok: false, message: err };
    return { ok: true };
  } catch (err) {
    log.warn(`[market] setCurrency(${currency}) failed`, err);
    return { ok: false, message: err instanceof Error ? err.message : 'currency_failed' };
  }
};

const normalizeLetter = (raw: RawLetter, idx: number): MailLetter => ({
  id: String(raw.id ?? idx),
  subject: asString(raw.subject) ?? asString(raw.title),
  from: asString(raw.from) ?? asString(raw.sender),
  to: asString(raw.to),
  date: asNumber(raw.date) ?? asNumber(raw.timestamp),
  textPlain: asString(raw.textPlain) ?? asString(raw.text) ?? asString(raw.body),
  textHtml: asString(raw.textHtml) ?? asString(raw.html),
});

const lettersError = (resp: { error?: string; errors?: string[] | string }): string | null => {
  if (typeof resp.error === 'string' && resp.error) return resp.error;
  return tagOpError(resp);
};

export const fetchLetters = async (
  req: MailLettersRequest,
  signal?: AbortSignal,
): Promise<MailLettersResult> => {
  const token = await loadToken();
  if (!token) return { ok: false, message: 'not_authenticated' };
  for (let attempt = 0; attempt < 50; attempt++) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' };
    try {
      const resp = await getClient().getLetters(req, signal);
      const err = lettersError(resp);
      if (err === 'retry_request') {
        await sleep(1500, signal);
        continue;
      }
      if (err) return { ok: false, message: err };
      const rawList = resp.letters ?? resp.items ?? [];
      return { ok: true, letters: rawList.map(normalizeLetter) };
    } catch (err) {
      log.warn('[market] fetchLetters failed', err);
      return { ok: false, message: err instanceof Error ? err.message : 'letters_failed' };
    }
  }
  return { ok: false, message: 'retry_request' };
};

export interface MarketProxy {
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const asStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined;

const normalizeProxy = (raw: unknown): MarketProxy | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const host = asStr(o.proxy_ip ?? o.ip ?? o.host ?? o.address ?? o.server);
  const portStr = asStr(o.proxy_port ?? o.port);
  const port = portStr ? Number(portStr) : Number.NaN;
  if (!host || !isProxyHost(host)) return null;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const type = (asStr(o.proxy_type ?? o.type ?? o.protocol) ?? 'http').toLowerCase();
  return {
    protocol: type.includes('https') ? 'https' : 'http',
    host,
    port,
    username: asStr(o.proxy_user ?? o.username ?? o.user ?? o.login),
    password: asStr(o.proxy_pass ?? o.password ?? o.pass),
  };
};

const collectProxyRecords = (data: unknown): unknown[] => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const key of ['proxies', 'proxy', 'items', 'data']) {
      const v = o[key];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>);
    }
  }
  return [];
};

export const fetchMarketProxies = async (): Promise<MarketProxy[]> => {
  const token = await loadToken();
  if (!token) throw new Error('not_authenticated');
  const data = await getClient().listProxies();
  const list = collectProxyRecords(data)
    .map(normalizeProxy)
    .filter((p): p is MarketProxy => p !== null);
  log.info(`[market] fetched ${list.length} proxy(ies) from forum`);
  return list;
};

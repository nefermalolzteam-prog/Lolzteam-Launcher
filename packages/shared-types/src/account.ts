import type { LlmServiceId } from './llm-service';
import type { ServiceId } from './service-registry';

export interface SteamGame {
  appId: number;
  /** Icon lives at https://nztcdn.com/steam/icon/{parentGameId}.webp */
  parentGameId: number;
  title: string;
  /** Total hours played (the API already reports this in hours). */
  hours: number;
}

export interface AccountTag {
  id: number;
  title: string;
  bc?: string;
}

export interface UserLabel {
  id: number;
  title: string;
  bc: string;
  isDefault: boolean;
  forOwnedAccountsOnly: boolean;
}

export const PROTECTED_LABEL_IDS: readonly number[] = [4, 5, 6];

export const isEditableLabel = (label: Pick<UserLabel, 'id' | 'isDefault'>): boolean =>
  label.id >= 4 && !label.isDefault && !PROTECTED_LABEL_IDS.includes(label.id);

export type MarketCurrency =
  | 'rub'
  | 'uah'
  | 'kzt'
  | 'byn'
  | 'usd'
  | 'eur'
  | 'gbp'
  | 'cny'
  | 'try'
  | 'jpy'
  | 'brl';

export const MARKET_CURRENCIES: readonly MarketCurrency[] = [
  'rub',
  'uah',
  'kzt',
  'byn',
  'usd',
  'eur',
  'gbp',
  'cny',
  'try',
  'jpy',
  'brl',
];

export interface SteamInfo {
  tags: AccountTag[];
  level: number | null;
  gameCount: number | null;
  isLimited: boolean;
  /** Last activity, unix seconds. */
  lastActivity: number | null;
  vacBanned: boolean;
  communityBanned: boolean;
  tradeBanned: boolean;
  /** Human-readable balance as the API renders it (e.g. "0₴"). */
  balance: string | null;
  /** Origin phrase, e.g. "Авторег". */
  origin: string | null;
  /** ISO 3166 alpha-2 country code, e.g. "US". */
  country: string | null;
  /** Top games by hours, icons resolvable via parentGameId. */
  games: SteamGame[];
  /** How many VAC bans; the web prints the count when it is above one. */
  vacCount: number | null;
  /** `steam_cs2_ban_date_active` — a CS2 ban that has not expired yet. */
  cs2BanActive: boolean;
  /** `steam_cs2_ban_date`, unix seconds. */
  cs2BanDate: number | null;
  /** `steam_market_ban_end_date`, unix seconds. */
  marketBanEndsAt: number | null;
  /** Perfect World account — its CS2 copy only runs on the Chinese servers. */
  chineseAccount: boolean;
  /** Amount already spent towards lifting the "limited account" flag. */
  limitSpent: number | null;
  /** Wallet balance converted to the viewer's currency. */
  convertedBalance: number | null;
  /** Steam inventory value, viewer's currency. */
  inventoryValue: number | null;
  /** Hours played over the last two weeks. */
  hoursRecent: number | null;
  /** Last store transaction, unix seconds. */
  lastTransaction: number | null;
  /** Account creation date, unix seconds. */
  registerDate: number | null;
  points: number | null;
  friendCount: number | null;
  faceitLevel: number | null;
  giftCount: number | null;
}

/** The raw `telegram_spam_block` ladder. */
export const TG_SPAM_NONE = -1;
export const TG_SPAM_SKIPPED = -2;
export const TG_SPAM_FOREVER = -3;
export const TG_SPAM_GEO = -4;

export interface TelegramInfo {
  /** Phone, username and id are absent from the `/telegram` listing schema — they only arrive with the item detail. */
  phone: string | null;
  username: string | null;
  /** Telegram user id. */
  id: number | null;
  /** ISO 3166 alpha-2 country code, e.g. "US". */
  country: string | null;
  /** Last seen, unix seconds. */
  lastSeen: number | null;
  /** Active Premium subscription. */
  premium: boolean;
  /** Premium expiry, unix seconds. */
  premiumExpires: number | null;
  /** True when the account is under a spam block. */
  spamBlocked: boolean;
  /** The raw ladder value behind `spamBlocked` — see the `TG_SPAM_*` constants. */
  spamBlock: number | null;
  tags: AccountTag[];
  /** Origin phrase, e.g. "Авторег". */
  origin: string | null;
  channelsCount: number | null;
  chatsCount: number | null;
  contactsCount: number | null;
  conversationsCount: number | null;
  adminCount: number | null;
  /** Subscribers across the channels the account administrates. */
  adminSubsCount: number | null;
  starsCount: number | null;
  /** Birthday set on the profile, unix seconds. */
  birthday: number | null;
  /** A 2FA password is set on the account. */
  passwordSet: boolean;
}

/** Discord badge data. */
export interface DiscordInfo {
  tags: AccountTag[];
  /** Origin phrase, e.g. "Авторег". */
  origin: string | null;
  /** Client locale code ("ru", "en-US"). */
  locale: string | null;
  /** The same locale spelled out by the market, e.g. "Русский". */
  localeTitle: string | null;
  /** A phone number is attached ("с мобилой"). */
  verified: boolean;
  /** Market condition phrase id — "clear", "spam", … The web paints `spam` in the warning colour and everything else neutral. */
  condition: string | null;
  /** The market's own rendering of `condition`, used when we have no wording. */
  conditionLabel: string | null;
  /** A working payment method is attached. */
  billing: boolean;
  /** Undelivered Nitro gifts on the account. */
  gifts: number | null;
  /** Account creation date, unix seconds. */
  registerDate: number | null;
  chatCount: number | null;
  adminServersCount: number | null;
  /** Members across the servers the account administrates. */
  adminMembersCount: number | null;
  /** The market's own name for the tier, e.g. "Nitro Basic". */
  nitroTypeLabel: string | null;
  /** Nitro expiry, unix seconds. */
  nitroEndDate: number | null;
  /** Server boosts the account can still hand out. */
  boosts: number | null;
}

/** Instagram listing data. */
export interface InstagramInfo {
  tags: AccountTag[];
  /** Origin phrase, e.g. "Авторег". */
  origin: string | null;
  /** Instagram's own user id (`instagram_id`), not the market item id. */
  id: number | null;
  /** Handle, without the "@". */
  username: string | null;
  /** ISO 3166 alpha-2 country code, e.g. "US". */
  country: string | null;
  followerCount: number | null;
  followCount: number | null;
  postCount: number | null;
  /** Account creation date, unix seconds. */
  registerDate: number | null;
  /** A phone number is attached to the account. */
  mobile: boolean;
  /** Session cookies ship with the item. */
  hasCookies: boolean;
  /** The seller says login:password works on its own, cookies or not. */
  loginWithoutCookies: boolean;
}

/** TikTok listing data, mapped from the `tiktok_*` properties of the market item schema. */
export interface TikTokInfo {
  tags: AccountTag[];
  /** Origin phrase, e.g. "Авторег". */
  origin: string | null;
  /** Handle, without the "@" (`tiktok_unique_id`) — what the profile URL uses. */
  username: string | null;
  /** Display name; on a fresh account it is the handle over again. */
  screenName: string | null;
  /** ISO 3166 alpha-2 of `tiktok_top_country`. */
  topCountry: string | null;
  followerCount: number | null;
  followingCount: number | null;
  /** Likes received across all videos — TikTok's own headline number. */
  likeCount: number | null;
  videoCount: number | null;
  /** Coin balance: TikTok's currency for gifts. */
  coins: number | null;
  /** Account creation date, unix seconds (`tiktok_create_time`). */
  registerDate: number | null;
  verified: boolean;
  /** Posts are visible to approved followers only. */
  privateAccount: boolean;
  hasEmail: boolean;
  hasMobile: boolean;
  /** Live streaming is unlocked — TikTok gates it behind a follower count. */
  canStream: boolean;
  /** …and from LIVE Studio, gated separately, which is what streamers want. */
  canStreamStudio: boolean;
}

/** LLM listing data, mapped from the `llm_*` properties of the market item schema. */
export interface LlmInfo {
  /** Plan code exactly as the market spells it (`claude_pro`, `chatgptgoplan`, `grok_super_lite`). */
  subscription: string | null;
  /** Subscription expiry, unix seconds. */
  subscriptionEnds: number | null;
  /** The plan renews itself — i.e. the seller's card is still attached. */
  subscriptionAutoRenew: boolean;
  /** Account creation date on the provider's side, unix seconds. */
  registerDate: number | null;
  /** Session cookies ship with the item — presence only, never the value. */
  hasCookies: boolean;
  /** Share of the plan's quota already spent, 0…100. */
  usagePercent: number | null;
  /** Prepaid API credit as the market renders it, currency sign included ("$12.34") — the console balance. */
  balance: string | null;
  /** The same balance converted to the user's currency, as a number. */
  convertedBalance: number | null;
  /** Identity check passed on the provider's side. */
  kycVerified: boolean | null;
  /** A phone number is attached to the account. */
  hasPhone: boolean | null;
}

/** Scopes served by lzt.market: the user's purchases vs their own listings. */
export type MarketScope = 'purchased' | 'listed';

/** Where an account came from: lzt.market, or the user's own local store. */
export type AccountScope = MarketScope | 'local';

/** Locally added accounts are told apart by their scope alone. */
export const isLocalAccount = (account: Pick<AccountSummary, 'scope'>): boolean =>
  account.scope === 'local';

export interface AccountSummary {
  itemId: number;
  category: ServiceId | null;
  categoryRaw: string;
  categoryTitle: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  imageUrl: string | null;
  tags: AccountTag[];
  warrantyEndsAt: number | null;
  publishedAt: number | null;
  /** When the buyer purchased the item, unix seconds. */
  purchasedAt: number | null;
  isPurchased: boolean;
  /** 'purchased' = bought by the user; 'listed' = their own listing; 'local' = added by hand and stored only on this machine. */
  scope: AccountScope;
  /** Present only for Steam items; null when fields are unavailable. */
  steam: SteamInfo | null;
  /** Present only for Telegram items; null when fields are unavailable. */
  telegram: TelegramInfo | null;
  /** Present only for Discord items; null when fields are unavailable. */
  discord: DiscordInfo | null;
  /** Present only for Instagram items; null when fields are unavailable. */
  instagram: InstagramInfo | null;
  /** Present only for TikTok items; null when fields are unavailable. */
  tiktok: TikTokInfo | null;
  /** For LLM (category 6) items: the detected sub-service (claude/chatgpt/…). */
  llmService: LlmServiceId | null;
  /** Present only for LLM items; null when fields are unavailable. */
  llm: LlmInfo | null;
  /** True when the account exposes a viewable email inbox (login:password). */
  hasEmailLogin: boolean;
  /** Steam Guard maFile (Steam Desktop Authenticator secret) on file: `true` — present, `false` — the account has none. */
  hasMafile: boolean | null;
  /** The user's own note on the item, or `null` when there is none. */
  note: string | null;
  /** Folder the account sits in inside the local base, relative to its service root: `''` at the top. */
  folder: string | null;
  /** Local account only: the market item it was copied from, `null` otherwise. */
  marketItemId: number | null;
  /** Market item only: the id of the local account copied from it, `null` when there is none. */
  localCopyId: number | null;
}

/** A single account as much as the window is allowed to know it: the same public summary the list is made. */
export interface AccountPreview extends AccountSummary {
  /** Whether the API returned this account's private data — i.e. the current user owns/purchased it. */
  owned: boolean;
}

/** Everything about an account, credentials included. */
export interface AccountDetails extends AccountPreview {
  loginRaw: string | null;
  passwordRaw: string | null;
  secrets: Record<string, unknown>;
}

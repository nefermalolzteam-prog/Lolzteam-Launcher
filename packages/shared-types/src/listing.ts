/** Where a seller says the account came from. */
export type ItemOrigin =
  | 'brute'
  | 'phishing'
  | 'stealer'
  | 'personal'
  | 'resale'
  | 'autoreg'
  | 'self_registration'
  | 'retrieve'
  | 'retrieve_via_support'
  | 'dummy';

/** Every origin the market knows, in its own order. */
export const ITEM_ORIGINS: readonly ItemOrigin[] = [
  'brute',
  'phishing',
  'stealer',
  'personal',
  'resale',
  'autoreg',
  'self_registration',
  'retrieve',
  'retrieve_via_support',
  'dummy',
];

/**
 * Which origins a category actually accepts. The market rejects an edit that
 * names an origin outside its category's list, so the dialog must not offer
 * one: most categories take the six below, and the rest add or drop values.
 */
const COMMON_ORIGINS: readonly ItemOrigin[] = [
  'brute',
  'phishing',
  'stealer',
  'personal',
  'resale',
  'autoreg',
];

const ORIGINS_BY_CATEGORY: Record<string, readonly ItemOrigin[]> = {
  steam: [...COMMON_ORIGINS, 'dummy', 'retrieve_via_support'],
  fortnite: [...COMMON_ORIGINS, 'retrieve_via_support'],
  vk: [...COMMON_ORIGINS, 'retrieve'],
  telegram: [...COMMON_ORIGINS.filter((o) => o !== 'brute'), 'self_registration'],
  discord: COMMON_ORIGINS.filter((o) => o !== 'brute'),
  battlenet: COMMON_ORIGINS.filter((o) => o !== 'phishing'),
};

/**
 * The origins offered for a listing. An origin the market already reported is
 * always kept, even outside the category's list: it is the listing's own
 * answer, and dropping it would leave the dialog with nothing selected.
 */
export const originsForCategory = (
  categoryRaw: string | null,
  current: ItemOrigin | null = null,
): readonly ItemOrigin[] => {
  const list = ORIGINS_BY_CATEGORY[(categoryRaw ?? '').toLowerCase()] ?? COMMON_ORIGINS;
  return current && !list.includes(current) ? [...list, current] : list;
};

/** How the seller says the item's mailbox was obtained. */
export type ItemEmailType = 'native' | 'autoreg';

/**
 * The fields `Managing.Edit` accepts. Every field left out keeps its current
 * value; `currency` is required whenever `price` moves, and filling only one of
 * `title`/`title_en` makes the market translate the other itself.
 */
export interface ItemEditFields {
  title?: string;
  title_en?: string;
  price?: number;
  currency?: string;
  item_origin?: ItemOrigin;
  email_type?: ItemEmailType;
  allow_ask_discount?: boolean;
  proxy_id?: number;
  description?: string;
  information?: string;
}

/**
 * What the market says about the seller's own listing right now: both which
 * actions are live and what the editable fields currently hold, so the edit
 * dialog can show the real values instead of asking for them blind.
 */
export interface ListingCapabilities {
  canOpen: boolean;
  canClose: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canStick: boolean;
  canUnstick: boolean;
  canBump: boolean;
  canAutoBump: boolean;
  /** Why a bump is refused right now — plain text, tags already stripped. */
  bumpBlockedReason: string | null;
  /** Hours between automatic bumps, `null` when auto-bump is off. */
  autoBumpHours: number | null;
  /** How long the guarantee on this listing runs, in seconds. */
  guaranteeSeconds: number | null;

  /** The English title, when the listing carries one of its own. */
  titleEn: string | null;
  /** `null` when the market did not say — the dialog then offers «leave as is». */
  allowAskDiscount: boolean | null;
  origin: ItemOrigin | null;
  emailType: ItemEmailType | null;
}

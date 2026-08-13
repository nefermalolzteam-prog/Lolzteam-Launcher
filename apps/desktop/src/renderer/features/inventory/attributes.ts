import type { AccountSummary, ServiceId } from '@shared-types';
import { TG_SPAM_NONE } from '@shared-types';
import type { CheckSources } from './accountValidity';

/** One-click quality filters over what is known about an item. */
export interface AccountAttribute {
  id: string;
  /** The category tab this chip belongs to; `null` shows it on every tab. */
  service: ServiceId | null;
  match: (item: AccountSummary, src: CheckSources) => boolean;
}

/** Minor units — the same floor the card badges use to call a balance real. */
const MONEY_FLOOR = 1000;

const spamBlockClear = (raw: number | null): boolean => {
  if (raw === null) return false;
  if (raw === TG_SPAM_NONE) return true;
  // Positive values are the unix second the block runs until; a past one is no block at all.
  return raw > 0 && raw * 1000 <= Date.now();
};

export const ACCOUNT_ATTRIBUTES: readonly AccountAttribute[] = [
  { id: 'hasEmail', service: null, match: (it) => it.hasEmailLogin },
  // Not a property of the account but of what the user did with it — and that is the point.
  { id: 'hasNote', service: null, match: (it) => it.note !== null },

  /** Clean by whichever of the two looked last. */
  {
    id: 'steamNoBan',
    service: 'steam',
    match: (it, src) => {
      const check = src.checks.get(it.itemId);
      if (check && check.status !== 'unlinked') {
        if (check.vacBanned === true) return false;
        if (check.tradeBanState !== null && check.tradeBanState !== 'None') return false;
        if (it.steam === null) return true;
      }
      return (
        it.steam !== null &&
        !it.steam.vacBanned &&
        !it.steam.communityBanned &&
        !it.steam.tradeBanned &&
        !it.steam.cs2BanActive
      );
    },
  },
  { id: 'steamMafile', service: 'steam', match: (it) => it.hasMafile === true },
  {
    id: 'steamNotLimited',
    service: 'steam',
    match: (it, src) => {
      const limited = src.checks.get(it.itemId)?.limited;
      if (limited != null) return !limited;
      return it.steam?.isLimited === false;
    },
  },
  {
    id: 'steamBalance',
    service: 'steam',
    match: (it) => (it.steam?.convertedBalance ?? 0) > MONEY_FLOOR,
  },
  {
    id: 'steamInventory',
    service: 'steam',
    match: (it) => (it.steam?.inventoryValue ?? 0) > MONEY_FLOOR,
  },
  { id: 'steamFaceit', service: 'steam', match: (it) => (it.steam?.faceitLevel ?? 0) > 0 },

  /** The spam block, as the @SpamBot answered it if it was ever asked. */
  {
    id: 'tgNoSpam',
    service: 'telegram',
    match: (it, src) => {
      const spam = src.profiles.get(it.itemId)?.spam;
      if (spam) return spam.status === 'free';
      return it.telegram !== null && spamBlockClear(it.telegram.spamBlock);
    },
  },
  {
    id: 'tgPremium',
    service: 'telegram',
    match: (it, src) =>
      src.profiles.get(it.itemId)?.premium === true || it.telegram?.premium === true,
  },
  // A 2FA password is the one thing that can lock the login out entirely.
  {
    id: 'tgNoPassword',
    service: 'telegram',
    match: (it) => it.telegram !== null && !it.telegram.passwordSet,
  },

  { id: 'dcVerified', service: 'discord', match: (it) => it.discord?.verified === true },
  { id: 'dcNitro', service: 'discord', match: (it) => it.discord?.nitroEndDate != null },
  { id: 'dcBilling', service: 'discord', match: (it) => it.discord?.billing === true },
  {
    id: 'dcClean',
    service: 'discord',
    match: (it) => it.discord !== null && it.discord.condition?.toLowerCase() !== 'spam',
  },

  // Cookies are what the browser login actually logs.
  { id: 'igCookies', service: 'instagram', match: (it) => it.instagram?.hasCookies === true },
  { id: 'igMobile', service: 'instagram', match: (it) => it.instagram?.mobile === true },
  {
    id: 'igFollowers',
    service: 'instagram',
    match: (it) => (it.instagram?.followerCount ?? 0) > 0,
  },

  { id: 'ttVerified', service: 'tiktok', match: (it) => it.tiktok?.verified === true },
  // Going live is gated behind a follower count.
  { id: 'ttStream', service: 'tiktok', match: (it) => it.tiktok?.canStream === true },
  { id: 'ttEmail', service: 'tiktok', match: (it) => it.tiktok?.hasEmail === true },
  {
    id: 'ttFollowers',
    service: 'tiktok',
    match: (it) => (it.tiktok?.followerCount ?? 0) > 0,
  },
];

const BY_ID = new Map(ACCOUNT_ATTRIBUTES.map((a) => [a.id, a]));

/** Every selected attribute has to hold (AND, not OR): the chips answer different questions. */
export const matchesAttributes = (
  item: AccountSummary,
  ids: readonly string[],
  src: CheckSources,
): boolean => {
  for (const id of ids) {
    const attr = BY_ID.get(id);
    // An id from an older build that no longer exists must not silently filter the whole list away.
    if (attr && !attr.match(item, src)) return false;
  }
  return true;
};

/** Chips to offer on a given category tab: the common ones plus that service's. */
export const attributesFor = (service: ServiceId | 'all'): readonly AccountAttribute[] =>
  ACCOUNT_ATTRIBUTES.filter((a) => a.service === null || a.service === service);

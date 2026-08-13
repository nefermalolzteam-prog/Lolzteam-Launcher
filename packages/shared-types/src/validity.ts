import type { AccountTag } from './account';
import type { SteamCheckStatus } from './steam-check';
import type { TelegramCheckStatus } from './telegram-base';

export type AccountValidity = 'unknown' | 'valid' | 'invalid';

/** lzt.market tag ids. */
export const VALID_TAG_ID = 1;
export const INVALID_TAG_ID = 2;

/** The two tags the header draws itself, so they are not repeated as chips. */
export const STATUS_TAG_IDS: ReadonlySet<number> = new Set([VALID_TAG_ID, INVALID_TAG_ID]);

/** What the market says. */
export const validityFromTags = (
  tags: readonly AccountTag[] | null | undefined,
): AccountValidity => {
  if (!tags) return 'unknown';
  if (tags.some((tag) => tag.id === INVALID_TAG_ID)) return 'invalid';
  if (tags.some((tag) => tag.id === VALID_TAG_ID)) return 'valid';
  return 'unknown';
};

/** A frozen account is not usable, so it is red — see `TelegramCheckStatus`. */
export const validityFromTelegram = (
  status: TelegramCheckStatus | null | undefined,
): AccountValidity => {
  if (status === 'alive') return 'valid';
  if (status === 'frozen' || status === 'dead') return 'invalid';
  return 'unknown';
};

/** `unlinked` deliberately maps to `unknown`: it means the launcher holds no session for the account. */
export const validityFromSteam = (status: SteamCheckStatus | null | undefined): AccountValidity => {
  if (status === 'alive') return 'valid';
  if (status === 'dead') return 'invalid';
  return 'unknown';
};

/** The first source that actually knows something wins. */
export const resolveValidity = (
  sources: readonly (AccountValidity | null | undefined)[],
): AccountValidity => sources.find((v) => v && v !== 'unknown') ?? 'unknown';

import type {
  AccountSummary,
  AccountTag,
  AccountValidity,
  SteamCheckRecord,
  TelegramProfile,
} from '@shared-types';
import {
  resolveValidity,
  validityFromSteam,
  validityFromTags,
  validityFromTelegram,
} from '@shared-types';
import { useMemo } from 'react';
import { useSteamChecks } from '~/stores/steamChecks';
import { useTelegramProfiles } from '~/stores/telegramProfiles';

/** «Непроверен / Невалид / Валид» for one account, in one place. */
export const resolveAccountValidity = (
  tags: readonly AccountTag[] | null | undefined,
  profile: TelegramProfile | undefined,
  check: SteamCheckRecord | undefined,
): AccountValidity =>
  resolveValidity([
    validityFromTelegram(profile?.status),
    validityFromSteam(check?.status),
    validityFromTags(tags),
  ]);

/** The two sidecar mirrors as one value. */
export interface CheckSources {
  profiles: ReadonlyMap<number, TelegramProfile>;
  checks: ReadonlyMap<number, SteamCheckRecord>;
}

export const validityOf = (item: AccountSummary, src: CheckSources): AccountValidity =>
  resolveAccountValidity(item.tags, src.profiles.get(item.itemId), src.checks.get(item.itemId));

/** When this account was last looked at, whichever service did the looking, or `null` for one nobody has checked. */
export const lastCheckedAt = (item: AccountSummary, src: CheckSources): number | null => {
  const telegram = src.profiles.get(item.itemId)?.checkedAt ?? null;
  const steam = src.checks.get(item.itemId)?.checkedAt ?? null;
  if (telegram === null) return steam;
  if (steam === null) return telegram;
  return Math.max(telegram, steam);
};

/** Both maps, subscribed once. */
export const useCheckSources = (): CheckSources => {
  const profiles = useTelegramProfiles((st) => st.profiles);
  const checks = useSteamChecks((st) => st.checks);
  return useMemo(() => ({ profiles, checks }), [profiles, checks]);
};

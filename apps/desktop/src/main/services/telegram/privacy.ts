import type { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type {
  TelegramCheckInfo,
  TelegramPrivacyKey,
  TelegramPrivacyRequest,
  TelegramPrivacyResult,
  TelegramPrivacyValue,
  TelegramTaskStep,
} from '@shared-types';
import { TELEGRAM_PRIVACY_PREMIUM_ONLY } from '@shared-types';
import log from 'electron-log/main';
import {
  checkInfoFromUser,
  deadCheckInfo,
  floodWaitSeconds,
  frozenCheckInfo,
  isDeadIdentityError,
  isFrozenError,
  readFreezeState,
  rpcErrorText,
} from './checker';

/** What the user picked, in the constructors Telegram accepts. */
const RULES: Record<TelegramPrivacyValue, readonly tl.TypeInputPrivacyRule[]> = {
  everybody: [{ _: 'inputPrivacyValueAllowAll' }],
  contacts: [{ _: 'inputPrivacyValueAllowContacts' }],
  nobody: [{ _: 'inputPrivacyValueDisallowAll' }],
};

/** Our names for the switches, in Telegram's. */
const KEYS: Record<TelegramPrivacyKey, tl.TypeInputPrivacyKey['_']> = {
  lastSeen: 'inputPrivacyKeyStatusTimestamp',
  profilePhoto: 'inputPrivacyKeyProfilePhoto',
  phone: 'inputPrivacyKeyPhoneNumber',
  forwards: 'inputPrivacyKeyForwards',
  calls: 'inputPrivacyKeyPhoneCall',
  groups: 'inputPrivacyKeyChatInvite',
  voices: 'inputPrivacyKeyVoiceMessages',
  bio: 'inputPrivacyKeyAbout',
  birthday: 'inputPrivacyKeyBirthday',
};

/** Telegram's way of saying "this switch is a paid feature". */
const PREMIUM_REQUIRED = 'PREMIUM_ACCOUNT_REQUIRED';

export interface PrivacyOutcome {
  readonly result: TelegramPrivacyResult;
  readonly info: TelegramCheckInfo;
}

const EMPTY: TelegramPrivacyResult = { applied: [], failed: [], needsPremium: [] };

/** Sorts the requested keys into the order they are written in. */
const ordered = (keys: readonly TelegramPrivacyKey[]): TelegramPrivacyKey[] =>
  [...keys].sort(
    (a, b) =>
      Number(TELEGRAM_PRIVACY_PREMIUM_ONLY.includes(a)) -
      Number(TELEGRAM_PRIVACY_PREMIUM_ONLY.includes(b)),
  );

export const applyTelegramPrivacy = async (
  client: TelegramClient,
  rules: TelegramPrivacyRequest['rules'],
  report: (step: TelegramTaskStep) => void,
): Promise<PrivacyOutcome> => {
  report('me');
  // Asked for its failure first, exactly as the profile fill does.
  let me: Awaited<ReturnType<TelegramClient['getMe']>>;
  try {
    me = await client.getMe();
  } catch (err) {
    const reason = isDeadIdentityError(err);
    if (reason) return { result: EMPTY, info: deadCheckInfo(reason) };
    const frozen = isFrozenError(err);
    if (frozen) return { result: EMPTY, info: frozenCheckInfo(frozen) };
    throw err;
  }

  const frozen = await readFreezeState(client);
  if (frozen) return { result: EMPTY, info: checkInfoFromUser(me, { frozen }) };

  const applied: TelegramPrivacyKey[] = [];
  const failed: TelegramPrivacyKey[] = [];
  const needsPremium: TelegramPrivacyKey[] = [];

  report('privacy');
  for (const key of ordered(Object.keys(rules) as TelegramPrivacyKey[])) {
    const value = rules[key];
    if (!value) continue;
    try {
      await client.call({
        _: 'account.setPrivacy',
        key: { _: KEYS[key] },
        rules: [...RULES[value]],
      });
      applied.push(key);
    } catch (err) {
      // A freeze stops the whole account: every remaining switch is the same refusal.
      const frozenNow = isFrozenError(err);
      if (frozenNow) {
        return {
          result: { applied, failed, needsPremium },
          info: checkInfoFromUser(me, { frozen: frozenNow }),
        };
      }
      // Not a failure of ours and not something the user can fix by retrying: the account simply cannot have this switch.
      if (rpcErrorText(err) === PREMIUM_REQUIRED) {
        needsPremium.push(key);
        continue;
      }
      // A flood wait has to reach the runner — it owns the waiting.
      if (floodWaitSeconds(err) !== null) throw err;
      failed.push(key);
      log.warn(`[telegram/privacy] ${key} refused`, err);
    }
  }

  return { result: { applied, failed, needsPremium }, info: checkInfoFromUser(me) };
};

import type { StringSessionData } from '@mtcute/node/utils.js';
import type { ProxyEntry } from '@shared-types';
import { getLocalAccount } from '../../accounts/local-store';
import { buildOfflineSession } from '../../adapters/telegram/session';
import { getSettings } from '../../settings/settings-store';

export interface ResolvedTelegramAccount {
  readonly accountId: number;
  readonly session: StringSessionData;
  readonly apiId: number | null;
  readonly apiHash: string | null;
  readonly deviceModel: string | null;
  /** Human-readable label for logs and progress rows. */
  readonly phone: string | null;
}

/** Why an account could not be turned into a session. */
export type ResolveFailure =
  | 'no_account'
  | 'not_telegram'
  | 'no_auth_key'
  | 'bad_auth_key'
  /** A market item: bought, but not copied into the base. */
  | 'not_in_base';

export type ResolveResult =
  | { ok: true; account: ResolvedTelegramAccount }
  | { ok: false; reason: ResolveFailure; message?: string };

const fromLocal = async (accountId: number): Promise<ResolveResult> => {
  const local = await getLocalAccount(accountId);
  if (!local) return { ok: false, reason: 'no_account' };
  if (local.service !== 'telegram') return { ok: false, reason: 'not_telegram' };

  try {
    return {
      ok: true,
      account: {
        accountId,
        session: buildOfflineSession({
          authKeyHex: local.authKey,
          dcId: local.dcId,
          userId: local.userId,
        }),
        apiId: null,
        apiHash: null,
        deviceModel: null,
        phone: local.phone,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'bad_auth_key',
      message: err instanceof Error ? err.message : String(err),
    };
  }
};

export const resolveTelegramAccount = (accountId: number): Promise<ResolveResult> =>
  accountId < 0 ? fromLocal(accountId) : Promise.resolve({ ok: false, reason: 'not_in_base' });

/** The proxy a Telegram operation should take, if any. */
export const telegramProxy = async (proxyId: string | null): Promise<ProxyEntry | null> => {
  if (!proxyId) return null;
  const settings = await getSettings();
  if (!settings.proxyEnabled) return null;
  if (!settings.proxyServices.includes('telegram')) return null;
  return settings.proxies.find((p) => p.id === proxyId) ?? null;
};

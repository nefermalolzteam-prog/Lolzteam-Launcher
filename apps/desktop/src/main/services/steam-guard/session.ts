import type { GuardStatus, ProxyEntry } from '@shared-types';
import log from 'electron-log/main';
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import { onDbRelocated } from '../../accounts/db-events';
import { getLocalAccount } from '../../accounts/local-store';
import { extractSteamCreds } from '../../adapters/steam/extract';
import { generateDeviceId } from '../../adapters/steam/mafile';
import { acquireMobileSession } from '../../adapters/steam/session';
import { getSettings } from '../../settings/settings-store';
import { fetchAccountDetails, fetchSteamMafileData } from '../market';
import { proxyUrlFor } from '../proxy';
import { onGuardRecordDropped } from './cache-events';
import { type GuardCode, getGuardCode } from './codes';
import { isMobileAccessToken, isTokenExpired, readTokenClaims } from './jwt';
import {
  type GuardRecord,
  deleteGuardRecord,
  getGuardRecord,
  saveGuardRecord,
} from './session-store';

/** Access tokens last ~24h; there is no reason to put them on disk. */
const accessTokens = new Map<number, string>();

// A record that is gone, or minted from a refresh token that has been replaced, takes its token with it.
onGuardRecordDropped((accountId) => accessTokens.delete(accountId));
// A different database is a different set of accounts behind the same ids.
onDbRelocated(() => accessTokens.clear());

export type GuardLinkResult =
  | { ok: true; record: GuardRecord }
  | { ok: false; reason: GuardFailure; message?: string };

export type GuardFailure =
  | 'no_account'
  | 'no_credentials'
  | 'not_linked'
  | 'session_expired'
  | 'network'
  | 'needs_email_code'
  | 'login_failed';

interface SteamCredentials {
  readonly login: string;
  readonly password: string;
  readonly sharedSecret: string | null;
  readonly identitySecret: string | null;
  readonly deviceId: string | null;
}

const proxyById = async (proxyId: string | null): Promise<ProxyEntry | undefined> => {
  if (!proxyId) return undefined;
  const settings = await getSettings();
  if (!settings.proxyEnabled) return undefined;
  return settings.proxies.find((p) => p.id === proxyId);
};

/** The route an account was linked through; every later request must take it too. */
export const getGuardProxy = (proxyId: string | null): Promise<ProxyEntry | undefined> =>
  proxyById(proxyId);

/** Hand-added accounts carry their secret in the local database; bought ones keep it on the market. */
type CredentialsResult =
  | { ok: true; creds: SteamCredentials }
  | { ok: false; reason: GuardFailure };

const resolveCredentials = async (accountId: number): Promise<CredentialsResult> => {
  if (accountId < 0) {
    const local = await getLocalAccount(accountId);
    if (!local || local.service !== 'steam') return { ok: false, reason: 'no_account' };
    return {
      ok: true,
      creds: {
        login: local.login,
        password: local.password,
        sharedSecret: local.sharedSecret,
        // Both are whatever the pasted maFile carried — `null` when the user pasted a bare `shared_secret`.
        identitySecret: local.identitySecret,
        deviceId: local.deviceId,
      },
    };
  }

  const found = await fetchAccountDetails(accountId);
  if (!found.ok) {
    return { ok: false, reason: found.reason === 'unreachable' ? 'network' : 'no_account' };
  }
  const creds = extractSteamCreds(found.details);
  if (!creds) return { ok: false, reason: 'no_credentials' };

  const mafile = await fetchSteamMafileData(accountId);
  return {
    ok: true,
    creds: {
      login: creds.login,
      password: creds.password,
      sharedSecret: mafile?.sharedSecret ?? creds.sharedSecret,
      identitySecret: mafile?.identitySecret ?? null,
      deviceId: mafile?.deviceId ?? null,
    },
  };
};

/** Signs in as the mobile app and stores what the authenticator needs. */
export const linkGuardAccount = async (
  accountId: number,
  options: { proxyId?: string | null; emailCode?: string } = {},
): Promise<GuardLinkResult> => {
  const resolved = await resolveCredentials(accountId);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const creds = resolved.creds;
  if (!creds.sharedSecret) return { ok: false, reason: 'no_credentials' };

  const proxy = await proxyById(options.proxyId ?? null);
  const result = await acquireMobileSession({
    login: creds.login,
    password: creds.password,
    sharedSecret: creds.sharedSecret,
    emailCode: options.emailCode,
    proxy,
  });

  if (!result.ok) {
    if (result.error.kind === 'needs-email-code') return { ok: false, reason: 'needs_email_code' };
    return {
      ok: false,
      reason: 'login_failed',
      message: 'message' in result.error ? result.error.message : result.error.kind,
    };
  }

  const existing = await getGuardRecord(accountId);
  const value = {
    accountId,
    steamId: result.data.steamId,
    accountName: result.data.accountName,
    refreshToken: result.data.refreshToken,
    sharedSecret: creds.sharedSecret,
    identitySecret: creds.identitySecret ?? existing?.identitySecret ?? null,
    deviceId: creds.deviceId ?? existing?.deviceId ?? generateDeviceId(),
    proxyId: options.proxyId ?? null,
  };
  if (!(await saveGuardRecord(value))) {
    return { ok: false, reason: 'login_failed', message: 'store_write_failed' };
  }

  if (result.data.accessToken && isMobileAccessToken(result.data.accessToken)) {
    accessTokens.set(accountId, result.data.accessToken);
  }
  log.info(`[steam-guard] linked account ${accountId} (${result.data.steamId})`);
  const saved = await getGuardRecord(accountId);
  return saved ? { ok: true, record: saved } : { ok: false, reason: 'not_linked' };
};

export const unlinkGuardAccount = async (accountId: number): Promise<boolean> => {
  accessTokens.delete(accountId);
  return deleteGuardRecord(accountId);
};

/** The stored record, topped up from the local database on the way out. */
export const readGuardRecord = async (accountId: number): Promise<GuardRecord | null> => {
  const record = await getGuardRecord(accountId);
  if (!record || accountId >= 0) return record;

  const local = await getLocalAccount(accountId);
  if (!local || local.service !== 'steam') return record;

  const sharedSecret = local.sharedSecret ?? record.sharedSecret;
  const identitySecret = local.identitySecret ?? record.identitySecret;
  const deviceId = local.deviceId ?? record.deviceId;
  if (
    sharedSecret === record.sharedSecret &&
    identitySecret === record.identitySecret &&
    deviceId === record.deviceId
  ) {
    return record;
  }

  const saved = await saveGuardRecord({
    accountId: record.accountId,
    steamId: record.steamId,
    accountName: record.accountName,
    refreshToken: record.refreshToken,
    sharedSecret,
    identitySecret,
    deviceId,
    proxyId: record.proxyId,
  });
  if (!saved) return record;
  log.info(`[steam-guard] refreshed maFile keys of account ${accountId} from the local base`);
  return (await getGuardRecord(accountId)) ?? record;
};

/** What the renderer is allowed to know about an account's authenticator. */
export const getGuardStatus = async (accountId: number): Promise<GuardStatus> => {
  const record = await readGuardRecord(accountId);
  if (record) {
    return {
      accountId,
      linked: true,
      steamId: record.steamId,
      accountName: record.accountName,
      hasSharedSecret: record.sharedSecret !== null,
      hasIdentitySecret: record.identitySecret !== null,
      proxyId: record.proxyId,
      linkedAt: record.createdAt,
    };
  }

  const local = accountId < 0 ? await getLocalAccount(accountId) : null;
  const steam = local?.service === 'steam' ? local : null;
  return {
    accountId,
    linked: false,
    steamId: '',
    accountName: steam?.login ?? '',
    hasSharedSecret: steam?.sharedSecret != null,
    // Both flags describe the disk, not the session.
    hasIdentitySecret: steam?.identitySecret != null,
    proxyId: null,
    linkedAt: null,
  };
};

/** The current Guard code. */
export const getGuardCodeFor = async (
  accountId: number,
): Promise<{ ok: true; code: GuardCode } | { ok: false; reason: GuardFailure }> => {
  const record = await getGuardRecord(accountId);
  const local = record?.sharedSecret || accountId >= 0 ? null : await getLocalAccount(accountId);
  const secret =
    record?.sharedSecret ?? (local?.service === 'steam' ? local.sharedSecret : null) ?? null;
  if (!secret) return { ok: false, reason: record ? 'no_credentials' : 'not_linked' };
  return { ok: true, code: await getGuardCode(secret) };
};

/** How long one `steam-session` call may take before it is given up on. */
const STEAM_OP_TIMEOUT_MS = 60_000;

class SteamStalledError extends Error {
  constructor(op: string) {
    super(`steam ${op} did not answer within ${STEAM_OP_TIMEOUT_MS}ms`);
    this.name = 'SteamStalledError';
  }
}

/** `work`, or a throw once the deadline passes. */
const withDeadline = async <T>(op: string, work: Promise<T>): Promise<T> => {
  // The deadline can win the race, and then `work` settles with nobody waiting on it.
  work.catch(() => {});

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SteamStalledError(op)), STEAM_OP_TIMEOUT_MS);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
};

const mintAccessToken = async (
  record: GuardRecord,
  override?: ProxyEntry,
): Promise<string | null> => {
  // The caller's route wins over the linked one.
  const proxy = override ?? (await proxyById(record.proxyId));
  const session = new LoginSession(EAuthTokenPlatformType.MobileApp, {
    ...(proxy ? { httpProxy: proxyUrlFor(proxy) } : {}),
  });
  session.refreshToken = record.refreshToken;
  await withDeadline('token refresh', session.refreshAccessToken());
  return session.accessToken || null;
};

/** Did Steam answer at all? */
const isSteamRefusal = (err: unknown): boolean =>
  typeof (err as { eresult?: unknown } | null)?.eresult === 'number';

export type TokenResult =
  | { ok: true; token: string; record: GuardRecord }
  | { ok: false; reason: GuardFailure; message?: string };

export interface TokenOptions {
  /** Mint a new token even when a usable one is cached. */
  readonly fresh?: boolean;
  /** The route this one call must take, in place of the account's linked one. */
  readonly proxy?: ProxyEntry;
}

/** A usable MobileApp access token, minted from the stored refresh token and kept in memory until shortly before it. */
export const getGuardAccessToken = async (
  accountId: number,
  options: TokenOptions = {},
): Promise<TokenResult> => {
  const record = await getGuardRecord(accountId);
  if (!record) return { ok: false, reason: 'not_linked' };

  const cached = accessTokens.get(accountId);
  if (!options.fresh && cached && !isTokenExpired(cached)) {
    return { ok: true, token: cached, record };
  }

  try {
    const token = await mintAccessToken(record, options.proxy);
    if (!token) return { ok: false, reason: 'session_expired' };
    if (!isMobileAccessToken(token)) {
      // Steam handed back something we cannot use; treat it as a dead link rather than letting LoginApprover throw on it later.
      log.warn(`[steam-guard] account ${accountId} got a non-mobile token`);
      return { ok: false, reason: 'session_expired' };
    }
    accessTokens.set(accountId, token);
    return { ok: true, token, record };
  } catch (err) {
    const refused = isSteamRefusal(err);
    // Only a refusal invalidates what we hold.
    if (refused) accessTokens.delete(accountId);
    log.warn(`[steam-guard] refresh failed for account ${accountId}`, err);
    return {
      ok: false,
      reason: refused ? 'session_expired' : 'network',
      message: err instanceof Error ? err.message : String(err),
    };
  }
};

/** steamID64 from the stored token, falling back to the record. */
export const getGuardSteamId = (record: GuardRecord, token: string): string =>
  readTokenClaims(token)?.sub ?? record.steamId;

/** Cookies for `steamcommunity.com`, which the confirmation and friend-list endpoints authenticate with. */
export const getGuardWebCookies = async (
  accountId: number,
  override?: ProxyEntry,
): Promise<{ ok: true; cookies: string[] } | { ok: false; reason: GuardFailure }> => {
  const record = await getGuardRecord(accountId);
  if (!record) return { ok: false, reason: 'not_linked' };
  try {
    const proxy = override ?? (await proxyById(record.proxyId));
    const session = new LoginSession(EAuthTokenPlatformType.MobileApp, {
      ...(proxy ? { httpProxy: proxyUrlFor(proxy) } : {}),
    });
    session.refreshToken = record.refreshToken;
    return { ok: true, cookies: await withDeadline('web cookies', session.getWebCookies()) };
  } catch (err) {
    log.warn(`[steam-guard] web cookies failed for account ${accountId}`, err);
    // The same split `getGuardAccessToken` makes.
    return { ok: false, reason: isSteamRefusal(err) ? 'session_expired' : 'network' };
  }
};

/** Test seam: drops cached access tokens. */
export const resetGuardTokensForTests = (): void => accessTokens.clear();

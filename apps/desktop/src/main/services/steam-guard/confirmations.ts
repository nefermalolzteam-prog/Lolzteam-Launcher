import type { GuardConfirmation, GuardConfirmationAction, ProxyEntry } from '@shared-types';
import log from 'electron-log/main';
import { onDbRelocated } from '../../accounts/db-events';
import { onGuardRecordDropped } from './cache-events';
import { guardHttp } from './http';
import {
  CONFIRMATION_TYPE,
  confirmationParams,
  parseConfirmationList,
  parseConfirmationOp,
} from './mobileconf';
import { type GuardFailure, getGuardProxy, getGuardWebCookies, readGuardRecord } from './session';
import type { GuardRecord } from './session-store';
import { getSteamTime } from './time';

const BASE = 'https://steamcommunity.com/mobileconf';
const ACK_URL = 'https://steamcommunity.com//trade/new/acknowledge';

export type ConfirmationFailure = GuardFailure | 'no_identity_secret' | 'steam_error';

export type ConfirmationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ConfirmationFailure; message?: string };

/** Web cookies are minted from the refresh token, so getting them is a network round trip. */
const cookieCache = new Map<number, string[]>();

// Cookies outlive the record they were minted from.
onGuardRecordDropped((accountId) => cookieCache.delete(accountId));
onDbRelocated(() => cookieCache.clear());

interface Context {
  readonly record: GuardRecord;
  readonly identitySecret: string;
  readonly cookies: string[];
  readonly proxy: ProxyEntry | undefined;
}

const buildContext = async (
  accountId: number,
  fresh: boolean,
): Promise<ConfirmationResult<Context>> => {
  // The reading that repairs a record linked before the local base kept whole maFiles.
  const record = await readGuardRecord(accountId);
  if (!record) return { ok: false, reason: 'not_linked' };
  if (!record.identitySecret) return { ok: false, reason: 'no_identity_secret' };

  if (fresh) cookieCache.delete(accountId);
  let cookies = cookieCache.get(accountId);
  if (!cookies) {
    const minted = await getGuardWebCookies(accountId);
    if (!minted.ok) return { ok: false, reason: minted.reason };
    cookies = minted.cookies;
    cookieCache.set(accountId, cookies);
  }

  return {
    ok: true,
    data: {
      record,
      identitySecret: record.identitySecret,
      cookies,
      proxy: await getGuardProxy(record.proxyId),
    },
  };
};

type Attempt<T> =
  | { kind: 'ok'; value: T }
  /** Cookies died mid-flight; one retry with fresh ones is worth the round trip. */
  | { kind: 'stale' }
  | { kind: 'fail'; reason: ConfirmationFailure; message?: string };

const withSession = async <T>(
  accountId: number,
  attempt: (ctx: Context) => Promise<Attempt<T>>,
): Promise<ConfirmationResult<T>> => {
  for (let pass = 0; pass < 2; pass++) {
    const ctx = await buildContext(accountId, pass > 0);
    if (!ctx.ok) return ctx;
    let result: Attempt<T>;
    try {
      result = await attempt(ctx.data);
    } catch (err) {
      log.warn(`[steam-guard] confirmation request failed for account ${accountId}`, err);
      return {
        ok: false,
        reason: 'steam_error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (result.kind === 'ok') return { ok: true, data: result.value };
    if (result.kind === 'fail') {
      return {
        ok: false,
        reason: result.reason,
        ...(result.message ? { message: result.message } : {}),
      };
    }
    cookieCache.delete(accountId);
  }
  return { ok: false, reason: 'session_expired' };
};

const paramsFor = async (ctx: Context, tag: string): Promise<URLSearchParams> =>
  confirmationParams({
    identitySecret: ctx.identitySecret,
    steamId: ctx.record.steamId,
    deviceId: ctx.record.deviceId,
    time: await getSteamTime(),
    tag,
  });

/** The pending confirmation list. */
export const listConfirmations = async (
  accountId: number,
): Promise<ConfirmationResult<GuardConfirmation[]>> =>
  withSession<GuardConfirmation[]>(accountId, async (ctx) => {
    const params = await paramsFor(ctx, 'list');
    const resp = await guardHttp({
      url: `${BASE}/getlist?${params.toString()}`,
      cookies: ctx.cookies,
      proxy: ctx.proxy,
    });
    // A redirect is Steam pointing at the login page: the cookies are dead.
    if (resp.status >= 300 && resp.status < 400) return { kind: 'stale' };

    const parsed = parseConfirmationList(resp.body);
    if (parsed.ok) return { kind: 'ok', value: parsed.confirmations };
    if (parsed.needAuth) return { kind: 'stale' };
    return {
      kind: 'fail',
      reason: 'steam_error',
      ...(parsed.message ? { message: parsed.message } : {}),
    };
  });

const sessionIdFrom = (cookies: readonly string[]): string | null => {
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name?.trim() === 'sessionid') return rest.join('=').trim() || null;
  }
  return null;
};

/** Steam refuses to act on a trade the account has never "seen" in the web UI. */
const acknowledgeTrade = async (ctx: Context): Promise<boolean> => {
  const sessionId = sessionIdFrom(ctx.cookies);
  if (!sessionId) return false;
  try {
    const resp = await guardHttp({
      url: ACK_URL,
      method: 'POST',
      cookies: ctx.cookies,
      body: new URLSearchParams({ sessionid: sessionId, message: '1' }).toString(),
      proxy: ctx.proxy,
    });
    return resp.status < 400;
  } catch (err) {
    log.warn('[steam-guard] trade acknowledge failed', err);
    return false;
  }
};

const runOp = async (
  ctx: Context,
  action: GuardConfirmationAction,
  items: readonly GuardConfirmation[],
): Promise<{ status: number; body: string }> => {
  const params = await paramsFor(ctx, action);
  params.set('op', action);

  if (items.length === 1 && items[0]) {
    params.set('cid', items[0].id);
    params.set('ck', items[0].nonce);
    return guardHttp({
      url: `${BASE}/ajaxop?${params.toString()}`,
      cookies: ctx.cookies,
      proxy: ctx.proxy,
    });
  }

  // `multiajaxop` takes the same fields as a form.
  for (const item of items) {
    params.append('cid[]', item.id);
    params.append('ck[]', item.nonce);
  }
  return guardHttp({
    url: `${BASE}/multiajaxop`,
    method: 'POST',
    cookies: ctx.cookies,
    body: params.toString(),
    proxy: ctx.proxy,
  });
};

/** Accepts or rejects confirmations — one, or the whole list at once. */
export const actOnConfirmations = async (
  accountId: number,
  action: GuardConfirmationAction,
  items: readonly GuardConfirmation[],
): Promise<ConfirmationResult<{ acted: number }>> => {
  if (items.length === 0) return { ok: true, data: { acted: 0 } };

  return withSession<{ acted: number }>(accountId, async (ctx) => {
    let resp = await runOp(ctx, action, items);
    if (resp.status >= 300 && resp.status < 400) return { kind: 'stale' };

    let parsed = parseConfirmationOp(resp.body);
    if (!parsed.ok && !parsed.needAuth && items.some((i) => i.type === CONFIRMATION_TYPE.TRADE)) {
      if (await acknowledgeTrade(ctx)) {
        resp = await runOp(ctx, action, items);
        parsed = parseConfirmationOp(resp.body);
      }
    }

    if (parsed.ok) {
      log.info(`[steam-guard] account ${accountId} ${action}ed ${items.length} confirmation(s)`);
      return { kind: 'ok', value: { acted: items.length } };
    }
    if (parsed.needAuth) return { kind: 'stale' };
    return {
      kind: 'fail',
      reason: 'steam_error',
      ...(parsed.message ? { message: parsed.message } : {}),
    };
  });
};

/** Test seam: drops cached web cookies. */
export const resetConfirmationCookiesForTests = (): void => cookieCache.clear();

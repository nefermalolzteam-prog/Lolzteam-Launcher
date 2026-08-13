import type {
  ProxyEntry,
  SteamFriendTarget,
  SteamFriendsResult,
  TelegramTaskStep,
} from '@shared-types';
import log from 'electron-log/main';
import { sleep } from '../../lib/sleep';
import { guardHttp } from '../steam-guard/http';
import { getGuardAccessToken, getGuardSteamId, getGuardWebCookies } from '../steam-guard/session';

/** The WebAPI list. */
const LIST_URL = 'https://api.steampowered.com/IFriendsListService/GetFriendsList/v1/';

/** One endpoint for all three targets, and not a shortcut: Steam's own friends page posts here to remove a friend. */
const REMOVE_URL = 'https://steamcommunity.com/actions/RemoveFriendAjax';
const BLOCK_URL = 'https://steamcommunity.com/actions/BlockUserAjax';

/** Pause between writes. */
const PACE_MS = 900;

/** Steam's own numbering, as the WebAPI reports it. */
export const EFriendRelationship = {
  None: 0,
  Blocked: 1,
  RequestRecipient: 2,
  Friend: 3,
  RequestInitiator: 4,
  Ignored: 5,
  IgnoredFriend: 6,
} as const;

export interface SteamRelation {
  readonly steamId: string;
  readonly relationship: number;
}

/** Which of the user's three lists a relationship belongs to, or `null` for one that belongs to none of them. */
export const friendTargetOf = (relationship: number): SteamFriendTarget | null => {
  switch (relationship) {
    case EFriendRelationship.Friend:
    case EFriendRelationship.IgnoredFriend:
      return 'friends';
    case EFriendRelationship.RequestRecipient:
      return 'incoming';
    case EFriendRelationship.RequestInitiator:
      return 'outgoing';
    default:
      return null;
  }
};

/** The list, read off the WebAPI answer. */
export const parseFriendsList = (body: string): SteamRelation[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const response = (parsed as { response?: unknown } | null)?.response;
  if (!response || typeof response !== 'object') return null;

  const list = (response as { friendslist?: { friends?: unknown } | null }).friendslist;
  if (!list) return [];
  const friends = list.friends;
  if (!Array.isArray(friends)) return [];

  const out: SteamRelation[] = [];
  for (const entry of friends) {
    const raw = (entry as { ulfriendid?: unknown } | null)?.ulfriendid;
    const steamId =
      typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
    if (!/^\d{6,20}$/.test(steamId)) continue;
    const rel = (entry as { efriendrelationship?: unknown }).efriendrelationship;
    out.push({ steamId, relationship: typeof rel === 'number' ? rel : EFriendRelationship.None });
  }
  return out;
};

/** `sessionid` doubles as the CSRF field every community write wants. */
const sessionIdFrom = (cookies: readonly string[]): string | null => {
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.split('=');
    if (name?.trim() === 'sessionid') return rest.join('=').trim() || null;
  }
  return null;
};

/** Did the write go through? */
export const wroteThrough = (body: string): boolean => {
  const text = body.trim();
  if (!text) return true;
  if (text === 'false' || text === 'null' || text === '0') return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return true;
  }
  if (typeof parsed === 'boolean') return parsed;
  if (!parsed || typeof parsed !== 'object') return true;
  const success = (parsed as { success?: unknown }).success;
  if (success === undefined) return true;
  return success === 1 || success === true;
};

export interface SteamFriendsOptions {
  readonly targets: readonly SteamFriendTarget[];
  readonly block: boolean;
}

/** Why a purge stopped early. */
export type SteamFriendsFailure =
  | { readonly reason: 'not_linked' }
  | { readonly reason: 'refused'; readonly detail: string | null }
  | { readonly reason: 'unreachable'; readonly detail: string | null }
  | { readonly reason: 'rate_limited' }
  | { readonly reason: 'cancelled' };

export interface SteamFriendsOutcome {
  /** How far the purge got. */
  readonly result: SteamFriendsResult;
  readonly failure: SteamFriendsFailure | null;
}

export interface SteamFriendsContext {
  readonly proxy?: ProxyEntry | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly report: (step: TelegramTaskStep) => void;
  /** Test seam: the pause between writes, in ms. */
  readonly paceMs?: number;
}

const EMPTY: SteamFriendsResult = { scanned: 0, removed: 0, blocked: 0, kept: 0, failed: 0 };

/** Empties one account's friends list of whatever the caller selected. */
export const purgeSteamFriends = async (
  accountId: number,
  options: SteamFriendsOptions,
  ctx: SteamFriendsContext,
): Promise<SteamFriendsOutcome> => {
  ctx.report('connecting');
  const token = await getGuardAccessToken(accountId, {
    ...(ctx.proxy ? { proxy: ctx.proxy } : {}),
  });
  if (!token.ok) {
    if (token.reason === 'not_linked') return { result: EMPTY, failure: { reason: 'not_linked' } };
    if (token.reason === 'network') {
      return { result: EMPTY, failure: { reason: 'unreachable', detail: token.message ?? null } };
    }
    return { result: EMPTY, failure: { reason: 'refused', detail: token.reason } };
  }
  const self = getGuardSteamId(token.record, token.token);

  ctx.report('friends');
  const list = await readFriendsList(token.token, ctx.proxy);
  if (!list.ok) return { result: EMPTY, failure: list.failure };

  const wanted = new Set(options.targets);
  const picked: SteamRelation[] = [];
  for (const relation of list.relations) {
    // Nothing sane puts the account itself in its own list.
    if (relation.steamId === self) continue;
    const target = friendTargetOf(relation.relationship);
    if (target && wanted.has(target)) picked.push(relation);
  }

  const scanned = list.relations.length;
  const kept = scanned - picked.length;
  if (picked.length === 0) {
    return { result: { ...EMPTY, scanned, kept }, failure: null };
  }

  ctx.report('purging');
  const cookies = await mintCookies(accountId, ctx.proxy);
  if (!cookies.ok) return { result: { ...EMPTY, scanned, kept }, failure: cookies.failure };

  let jar = cookies.cookies;
  let sessionId = cookies.sessionId;
  let removed = 0;
  let blocked = 0;
  let failed = 0;
  // The one retry this whole operation makes, and only for the specific case it fixes: cookies that went stale mid-run.
  let refreshed = false;

  const url = options.block ? BLOCK_URL : REMOVE_URL;
  const partial = (): SteamFriendsResult => ({ scanned, removed, blocked, kept, failed });

  for (const [index, relation] of picked.entries()) {
    if (ctx.signal?.aborted) return { result: partial(), failure: { reason: 'cancelled' } };
    if (index > 0) await sleep(ctx.paceMs ?? PACE_MS, ctx.signal);
    if (ctx.signal?.aborted) return { result: partial(), failure: { reason: 'cancelled' } };

    let response: { status: number; body: string };
    try {
      response = await guardHttp({
        url,
        method: 'POST',
        cookies: jar,
        body: `sessionID=${encodeURIComponent(sessionId)}&steamid=${encodeURIComponent(relation.steamId)}`,
        proxy: ctx.proxy,
      });
    } catch (err) {
      return {
        result: partial(),
        failure: {
          reason: 'unreachable',
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    }

    if (response.status === 429) return { result: partial(), failure: { reason: 'rate_limited' } };

    // `guardHttp` never follows a redirect, so a 302 arrives as itself.
    if (response.status === 302 || response.status === 401 || response.status === 403) {
      if (refreshed) {
        return { result: partial(), failure: { reason: 'refused', detail: 'cookies_rejected' } };
      }
      refreshed = true;
      const fresh = await mintCookies(accountId, ctx.proxy);
      if (!fresh.ok) return { result: partial(), failure: fresh.failure };
      jar = fresh.cookies;
      sessionId = fresh.sessionId;
      // Same person, one more go, without counting the bounce as a refusal.
      const retry = await writeOnce(url, jar, sessionId, relation.steamId, ctx.proxy);
      if (retry === 'rate_limited')
        return { result: partial(), failure: { reason: 'rate_limited' } };
      if (retry === 'unreachable') {
        return { result: partial(), failure: { reason: 'unreachable', detail: 'retry_failed' } };
      }
      if (retry === 'ok') {
        if (options.block) blocked += 1;
        else removed += 1;
      } else failed += 1;
      continue;
    }

    if (response.status !== 200) {
      log.warn(`[steam/friends] account ${accountId}: HTTP ${response.status}`);
      failed += 1;
      continue;
    }

    if (wroteThrough(response.body)) {
      if (options.block) blocked += 1;
      else removed += 1;
    } else {
      failed += 1;
    }
  }

  log.info(
    `[steam/friends] account ${accountId}: ${scanned} scanned, ${removed} removed, ${blocked} blocked, ${failed} failed`,
  );
  return { result: partial(), failure: null };
};

type WriteOutcome = 'ok' | 'refused' | 'rate_limited' | 'unreachable';

/** The retry after a cookie refresh. */
const writeOnce = async (
  url: string,
  cookies: readonly string[],
  sessionId: string,
  steamId: string,
  proxy: ProxyEntry | undefined,
): Promise<WriteOutcome> => {
  try {
    const response = await guardHttp({
      url,
      method: 'POST',
      cookies,
      body: `sessionID=${encodeURIComponent(sessionId)}&steamid=${encodeURIComponent(steamId)}`,
      proxy,
    });
    if (response.status === 429) return 'rate_limited';
    if (response.status !== 200) return 'refused';
    return wroteThrough(response.body) ? 'ok' : 'refused';
  } catch {
    return 'unreachable';
  }
};

type ListOutcome =
  | { ok: true; relations: SteamRelation[] }
  | { ok: false; failure: SteamFriendsFailure };

const readFriendsList = async (
  token: string,
  proxy: ProxyEntry | undefined,
): Promise<ListOutcome> => {
  let response: { status: number; body: string };
  try {
    response = await guardHttp({
      url: LIST_URL,
      headers: { Authorization: `Bearer ${token}` },
      proxy,
    });
  } catch (err) {
    return {
      ok: false,
      failure: { reason: 'unreachable', detail: err instanceof Error ? err.message : String(err) },
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, failure: { reason: 'refused', detail: `http_${response.status}` } };
  }
  if (response.status === 429) return { ok: false, failure: { reason: 'rate_limited' } };
  if (response.status !== 200) {
    return { ok: false, failure: { reason: 'unreachable', detail: `http_${response.status}` } };
  }

  const relations = parseFriendsList(response.body);
  if (!relations) {
    // Not the network and not the account: the endpoint answered something this parser does not know.
    return { ok: false, failure: { reason: 'unreachable', detail: 'unreadable_list' } };
  }
  return { ok: true, relations };
};

type CookieOutcome =
  | { ok: true; cookies: string[]; sessionId: string }
  | { ok: false; failure: SteamFriendsFailure };

const mintCookies = async (
  accountId: number,
  proxy: ProxyEntry | undefined,
): Promise<CookieOutcome> => {
  const web = await getGuardWebCookies(accountId, proxy);
  if (!web.ok) {
    if (web.reason === 'not_linked') return { ok: false, failure: { reason: 'not_linked' } };
    // A proxy that timed out is not an account that has to be relinked.
    if (web.reason === 'network') {
      return { ok: false, failure: { reason: 'unreachable', detail: 'no_cookies' } };
    }
    return { ok: false, failure: { reason: 'refused', detail: web.reason } };
  }
  const sessionId = sessionIdFrom(web.cookies);
  if (!sessionId) {
    // Steam has always set one alongside the login cookie; without it every write below would be refused as cross-site.
    return { ok: false, failure: { reason: 'refused', detail: 'no_session_id' } };
  }
  return { ok: true, cookies: web.cookies, sessionId };
};

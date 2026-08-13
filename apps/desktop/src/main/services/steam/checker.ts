import type { ProxyEntry, SteamCheckDetail, SteamCheckInfo, SteamCheckStatus } from '@shared-types';
import log from 'electron-log/main';
import { guardHttp } from '../steam-guard/http';
import { getGuardAccessToken, getGuardSteamId } from '../steam-guard/session';

/** The public XML view of a profile. */
const profileUrl = (steamId: string): string =>
  `https://steamcommunity.com/profiles/${steamId}/?xml=1`;

/** The six fields we want out of that page, read with regular expressions rather than an XML parser. */
export interface SteamProfileFacts {
  readonly nickname: string | null;
  readonly vacBanned: boolean | null;
  readonly tradeBanState: string | null;
  readonly limited: boolean | null;
  readonly privacy: string | null;
  readonly memberSince: string | null;
  readonly avatarUrl: string | null;
}

const NO_FACTS: SteamProfileFacts = {
  nickname: null,
  vacBanned: null,
  tradeBanState: null,
  limited: null,
  privacy: null,
  memberSince: null,
  avatarUrl: null,
};

/** The page with every `CDATA` section lifted out of it. */
interface XmlDoc {
  readonly markup: string;
  readonly cdata: readonly string[];
}

const CDATA_SECTION = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
/** The marker a lifted section leaves behind. */
const NUL = '\u0000';
const MARKER = new RegExp(`${NUL}(\\d+)${NUL}`, 'g');

const liftCdata = (xml: string): XmlDoc => {
  const cdata: string[] = [];
  // NUL cannot occur in a well-formed XML document.
  const markup = xml
    .split(NUL)
    .join('')
    .replace(CDATA_SECTION, (_all, body: string) => {
      cdata.push(body);
      return `\u0000${cdata.length - 1}\u0000`;
    });
  return { markup, cdata };
};

/** Markers back into text. */
const restore = (doc: XmlDoc, text: string): string =>
  text.replace(MARKER, (all, index: string) => doc.cdata[Number(index)] ?? all);

/** One tag's text, unwrapped from the `CDATA` Steam puts around anything a user typed — nicknames routinely carry `<`. */
const tagText = (doc: XmlDoc, tag: string): string | null => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(doc.markup);
  if (!match) return null;
  const text = restore(doc, (match[1] ?? '').trim()).trim();
  return text.length > 0 ? text : null;
};

/** `1`/`0` on the page. */
const tagFlag = (doc: XmlDoc, tag: string): boolean | null => {
  const text = tagText(doc, tag);
  if (text === '1') return true;
  if (text === '0') return false;
  return null;
};

/** Reads the profile page. */
export const parseSteamProfileXml = (xml: string): SteamProfileFacts => {
  const doc = liftCdata(xml);
  return {
    nickname: tagText(doc, 'steamID'),
    vacBanned: tagFlag(doc, 'vacBanned'),
    tradeBanState: tagText(doc, 'tradeBanState'),
    limited: tagFlag(doc, 'isLimitedAccount'),
    privacy: tagText(doc, 'privacyState'),
    memberSince: tagText(doc, 'memberSince'),
    avatarUrl: tagText(doc, 'avatarMedium'),
  };
};

/** Fetches the page through the run's proxy, and never throws. */
const readProfile = async (
  steamId: string,
  proxy: ProxyEntry | null,
): Promise<SteamProfileFacts> => {
  try {
    const response = await guardHttp({
      url: profileUrl(steamId),
      proxy: proxy ?? undefined,
    });
    if (response.status !== 200) {
      log.warn(`[steam/check] profile ${steamId} answered HTTP ${response.status}`);
      return NO_FACTS;
    }
    return parseSteamProfileXml(response.body);
  } catch (err) {
    log.warn(`[steam/check] profile ${steamId} unreachable`, err);
    return NO_FACTS;
  }
};

const verdict = (status: SteamCheckStatus, detail: SteamCheckDetail | null): SteamCheckInfo => ({
  ...NO_FACTS,
  status,
  steamId: null,
  detail,
});

/** What a failure is allowed to say out loud. */
const DETAIL_LIMIT = 120;

const shortDetail = (message: string | undefined): string | null => {
  if (!message) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what must not reach a tooltip or a log line
  const flat = message.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (flat.length === 0) return null;
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT - 1)}…` : flat;
};

export type SteamCheckResult =
  | { ok: true; info: SteamCheckInfo }
  /** A bought account was handed to the wrong checker; the market has its own. */
  | { ok: false; reason: 'market_account' }
  /** We never got an answer out of Steam — a timeout, a dead proxy, no route. */
  | { ok: false; reason: 'unreachable'; detail: string | null };

/** The whole check for one account. */
export const checkSteamAccount = async (
  accountId: number,
  proxy: ProxyEntry | null,
): Promise<SteamCheckResult> => {
  if (accountId >= 0) return { ok: false, reason: 'market_account' };

  // The run's proxy goes to the refresh as well as to the page.
  const token = await getGuardAccessToken(accountId, {
    fresh: true,
    ...(proxy ? { proxy } : {}),
  });
  if (!token.ok) {
    // Never linked at all: we hold no session, asked Steam nothing, and have nothing to report but that.
    if (token.reason === 'not_linked') return { ok: true, info: verdict('unlinked', null) };
    if (token.reason === 'network') {
      return { ok: false, reason: 'unreachable', detail: shortDetail(token.message) };
    }
    return {
      ok: true,
      info: verdict('dead', token.reason === 'session_expired' ? 'refused' : 'unknown'),
    };
  }

  const steamId = getGuardSteamId(token.record, token.token);
  const facts = await readProfile(steamId, proxy);
  return { ok: true, info: { ...facts, status: 'alive', steamId, detail: null } };
};

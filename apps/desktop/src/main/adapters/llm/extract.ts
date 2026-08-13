import type { AccountDetails } from '@shared-types';
import log from 'electron-log/main';
import {
  type InjectableCookie,
  type RawCookie,
  asCookieArray,
  toInjectable,
} from '../browser/extract';
import type { LlmProviderConfig } from './provider';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;

const COOKIE_FIELDS = ['cookies', 'llm_cookies', 'account_cookies'] as const;

export const extractLlmCookieArray = (details: AccountDetails): InjectableCookie[] => {
  const secrets = (details.secrets ?? {}) as Record<string, unknown>;
  const sources: unknown[] = [];
  for (const f of COOKIE_FIELDS) if (f in secrets) sources.push(secrets[f]);

  const ld = secrets.loginData;
  if (ld && typeof ld === 'object') {
    const o = ld as Record<string, unknown>;
    sources.push(o.cookies, o.cookie, o.login, o.password);
  }
  sources.push(details.loginRaw, details.passwordRaw);

  for (const src of sources) {
    const arr = asCookieArray(src);
    if (!arr) continue;
    const cookies = arr
      .map((c) => toInjectable(c as RawCookie))
      .filter((c): c is InjectableCookie => c !== null);
    if (cookies.length > 0) return cookies;
  }
  return [];
};

const looksLikeKey = (v: string): boolean => v.length >= 16 && !/\s/.test(v);

export const extractEmailCreds = (
  details: AccountDetails,
): { email: string; password: string } | null => {
  const secrets = (details.secrets ?? {}) as Record<string, unknown>;
  const pick = (o: unknown, k: string): string | null =>
    o && typeof o === 'object' ? asString((o as Record<string, unknown>)[k]) : null;
  const eld = secrets.emailLoginData ?? secrets.email_login_data;
  const ld = secrets.loginData;
  const email =
    pick(eld, 'login') ??
    pick(ld, 'login') ??
    asString(secrets.account_login) ??
    asString(details.loginRaw);
  const password =
    pick(eld, 'password') ??
    pick(ld, 'password') ??
    asString(secrets.account_password) ??
    asString(details.passwordRaw);
  return email && password ? { email, password } : null;
};

export const extractLlmKey = (details: AccountDetails, cookieName?: string): string | null => {
  const secrets = (details.secrets ?? {}) as Record<string, unknown>;
  log.debug(
    `[llm] secret keys for #${details.itemId}: ${Object.keys(secrets).join(', ') || 'none'}`,
  );

  const wanted = cookieName ?? 'sessionKey';
  const sessionCookie = extractLlmCookieArray(details).find((c) => c.name === wanted);
  if (sessionCookie?.value) return sessionCookie.value;

  const ld = secrets.loginData;
  const fromLoginData =
    ld && typeof ld === 'object'
      ? (asString((ld as Record<string, unknown>)[wanted]) ??
        asString((ld as Record<string, unknown>).sessionKey) ??
        asString((ld as Record<string, unknown>).cookie) ??
        asString((ld as Record<string, unknown>).login) ??
        asString((ld as Record<string, unknown>).password))
      : null;

  const candidates = [
    asString(secrets[wanted]),
    asString(secrets.sessionKey),
    asString(secrets.session_key),
    fromLoginData,
    asString(details.loginRaw),
    asString(details.passwordRaw),
    asString(secrets.account_cookies),
    asString(secrets.cookies),
  ];
  for (const c of candidates) {
    if (c && looksLikeKey(c)) return c;
  }
  return null;
};

export const resolveLlmCookies = (
  details: AccountDetails,
  provider: LlmProviderConfig,
): InjectableCookie[] => {
  const cookies = extractLlmCookieArray(details);
  if (cookies.length > 0) return cookies;

  const { cookieDomain, cookieName } = provider;
  const key = extractLlmKey(details, cookieName);
  if (!key) return [];

  if (!cookieDomain || !cookieName) return [];

  const host = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  return [
    {
      url: `https://${host}/`,
      name: cookieName,
      value: key,
      domain: cookieDomain,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS,
    },
  ];
};

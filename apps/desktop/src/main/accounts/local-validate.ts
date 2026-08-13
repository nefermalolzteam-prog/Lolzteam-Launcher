import type { LocalAccountRecord, LocalSteamRecord, LocalTelegramRecord } from '@shared-types';
import { isLocalServiceId } from '@shared-types';
import { parseMafile } from '../adapters/steam/mafile';

/** Fields the store needs; `id`/`createdAt`/`updatedAt` are the store's business. */
export type ValidatedSteam = Pick<
  LocalSteamRecord,
  'service' | 'label' | 'login' | 'password' | 'sharedSecret' | 'identitySecret' | 'deviceId'
>;
export type ValidatedTelegram = Pick<
  LocalTelegramRecord,
  'service' | 'label' | 'authKey' | 'dcId' | 'phone' | 'userId'
>;
export type ValidatedLocalAccount = ValidatedSteam | ValidatedTelegram;

export type ValidationResult =
  | { ok: true; value: ValidatedLocalAccount }
  | { ok: false; message: string };

const fail = (message: string): ValidationResult => ({ ok: false, message });

const LABEL_MAX = 64;
const LOGIN_MAX = 128;
const PASSWORD_MAX = 256;

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const field = (raw: unknown, key: string): string => asText((raw as Record<string, unknown>)[key]);

/** Steam `shared_secret` is 20 raw bytes; allow some slack, reject prose. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const isPlausibleSecret = (value: string): boolean => {
  if (!BASE64_RE.test(value)) return false;
  const bytes = Buffer.from(value, 'base64').length;
  return bytes >= 16 && bytes <= 64;
};

/** `android:<uuid>` in every maFile ever seen; the cap is only against prose. */
const DEVICE_ID_MAX = 128;

/** What a guard field is worth once parsed. */
export interface ParsedGuard {
  readonly sharedSecret: string;
  readonly identitySecret: string | null;
  readonly deviceId: string | null;
}

/** Accepts every shape the user can realistically paste into one field: a whole maFile. */
export const parseGuardInput = (raw: string): ParsedGuard | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const mafile = parseMafile(trimmed);
  const fromMafile = asText(mafile.sharedSecret);
  if (fromMafile) {
    if (!isPlausibleSecret(fromMafile)) return null;
    const identity = asText(mafile.identitySecret);
    const device = asText(mafile.deviceId);
    return {
      sharedSecret: fromMafile,
      identitySecret: identity && isPlausibleSecret(identity) ? identity : null,
      deviceId: device && device.length <= DEVICE_ID_MAX ? device : null,
    };
  }

  const bare = trimmed.replace(/\s+/g, '');
  return isPlausibleSecret(bare)
    ? { sharedSecret: bare, identitySecret: null, deviceId: null }
    : null;
};

/** The half of {@link parseGuardInput} that bulk import matches files on. */
export const parseSteamGuard = (raw: string): string | null =>
  parseGuardInput(raw)?.sharedSecret ?? null;

export interface ParsedAuthKey {
  /** 256-byte MTProto auth_key, lowercase hex. */
  authKeyHex: string;
  /** DC id carried by the pasted `<hex>:<dc>` form, if it had one. */
  dcId: number | null;
}

const HEX_256_BYTES = 256 * 2;
const isAuthKeyHex = (s: string): boolean => s.length === HEX_256_BYTES && /^[0-9a-fA-F]+$/.test(s);

const PROD_DC_MIN = 1;
const PROD_DC_MAX = 5;
const toDcId = (raw: string): number | null => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < PROD_DC_MIN || n > PROD_DC_MAX) return null;
  return n;
};

/** Accepts the two forms the auth_key is copied around in: the bare 512-char hex string. */
export const parseAuthKeyInput = (raw: string): ParsedAuthKey | null => {
  const compact = raw.replace(/\s+/g, '');
  if (!compact) return null;

  const sep = compact.lastIndexOf(':');
  if (sep > 0) {
    const hex = compact.slice(0, sep);
    const dcId = toDcId(compact.slice(sep + 1));
    if (!isAuthKeyHex(hex) || dcId === null) return null;
    return { authKeyHex: hex.toLowerCase(), dcId };
  }

  if (!isAuthKeyHex(compact)) return null;
  return { authKeyHex: compact.toLowerCase(), dcId: null };
};

/** E.164 digits, normalised to a leading `+` the way the adapter expects. */
const parsePhone = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
};

const parseUserId = (raw: string): number | null => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

const labelOr = (raw: string, fallback: string): string =>
  (raw || fallback).slice(0, LABEL_MAX).trim();

const validateSteam = (raw: unknown, previous: LocalSteamRecord | null): ValidationResult => {
  const login = field(raw, 'login');
  if (!login || login.length > LOGIN_MAX) return fail('invalid_login');

  // Secrets are never sent back to the form, so a blank field on edit means "leave it alone" — not "clear it".
  const passwordRaw =
    typeof (raw as { password?: unknown }).password === 'string'
      ? (raw as { password: string }).password
      : '';
  const password = passwordRaw || previous?.password || '';
  if (!password || password.length > PASSWORD_MAX) return fail('invalid_password');

  const clearGuard = (raw as { clearGuard?: unknown }).clearGuard === true;
  const guardRaw = field(raw, 'guard');
  let sharedSecret: string | null;
  let identitySecret: string | null;
  let deviceId: string | null;
  if (clearGuard) {
    sharedSecret = null;
    identitySecret = null;
    deviceId = null;
  } else if (!guardRaw) {
    sharedSecret = previous?.sharedSecret ?? null;
    identitySecret = previous?.identitySecret ?? null;
    deviceId = previous?.deviceId ?? null;
  } else {
    const parsed = parseGuardInput(guardRaw);
    if (parsed === null) return fail('invalid_guard');
    sharedSecret = parsed.sharedSecret;
    // A re-paste replaces the whole maFile, so its silence about the other two keys is an answer.
    identitySecret = parsed.identitySecret;
    deviceId = parsed.deviceId;
  }

  return {
    ok: true,
    value: {
      service: 'steam',
      label: labelOr(field(raw, 'label'), login),
      login,
      password,
      sharedSecret,
      identitySecret,
      deviceId,
    },
  };
};

const validateTelegram = (raw: unknown, previous: LocalTelegramRecord | null): ValidationResult => {
  const authKeyRaw = field(raw, 'authKey');
  let authKey: string;
  let embeddedDc: number | null = null;
  if (authKeyRaw) {
    const parsed = parseAuthKeyInput(authKeyRaw);
    if (!parsed) return fail('invalid_auth_key');
    authKey = parsed.authKeyHex;
    embeddedDc = parsed.dcId;
  } else {
    if (!previous) return fail('invalid_auth_key');
    authKey = previous.authKey;
  }

  const dcRaw = field(raw, 'dcId');
  let typedDc: number | null = null;
  if (dcRaw) {
    typedDc = toDcId(dcRaw);
    if (typedDc === null) return fail('invalid_dc');
  }
  // A DC pasted as part of the key belongs to that key; if the user also typed a different one.
  if (embeddedDc !== null && typedDc !== null && embeddedDc !== typedDc) return fail('dc_conflict');
  const dcId = embeddedDc ?? typedDc ?? previous?.dcId ?? null;
  if (dcId === null) return fail('invalid_dc');

  // Non-secret fields round-trip through the form, so blank here really is "clear".
  const phoneRaw = field(raw, 'phone');
  let phone: string | null = null;
  if (phoneRaw) {
    phone = parsePhone(phoneRaw);
    if (phone === null) return fail('invalid_phone');
  }

  const userIdRaw = field(raw, 'userId');
  let userId: number | null = null;
  if (userIdRaw) {
    userId = parseUserId(userIdRaw);
    if (userId === null) return fail('invalid_user_id');
  }

  return {
    ok: true,
    value: {
      service: 'telegram',
      label: labelOr(field(raw, 'label'), phone ?? `Telegram DC${dcId}`),
      authKey,
      dcId,
      phone,
      userId,
    },
  };
};

export const validateLocalAccount = (
  raw: unknown,
  previous: LocalAccountRecord | null = null,
): ValidationResult => {
  if (!raw || typeof raw !== 'object') return fail('invalid_input');
  const service = (raw as { service?: unknown }).service;
  if (!isLocalServiceId(service)) return fail('invalid_service');
  // Changing an account's service would leave the other service's fields dangling.
  if (previous && previous.service !== service) return fail('service_mismatch');

  return service === 'steam'
    ? validateSteam(raw, previous as LocalSteamRecord | null)
    : validateTelegram(raw, previous as LocalTelegramRecord | null);
};

import { randomInt } from 'node:crypto';

export interface TelegramSidecar {
  readonly phone: string | null;
  readonly userId: number | null;
  readonly apiId: number | null;
  readonly apiHash: string | null;
  readonly dcId: number | null;
  readonly device: string | null;
  readonly sdk: string | null;
  readonly appVersion: string | null;
  readonly langPack: string | null;
  readonly langCode: string | null;
  readonly systemLangPack: string | null;
  readonly systemLangCode: string | null;
  readonly twoFa: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly registerTime: number | null;
  /** Keys we did not recognise, preserved verbatim so a round trip loses nothing. */
  readonly extra: Readonly<Record<string, unknown>>;
}

const PHONE_KEYS = ['phone', 'telegram_phone', 'account_phone', 'number'];
/** `user_id` before `id`, and the order is load-bearing rather than alphabetical. */
const USER_ID_KEYS = ['user_id', 'id', 'telegram_id', 'userId'];
const API_ID_KEYS = ['app_id', 'api_id', 'appId', 'apiId'];
const API_HASH_KEYS = ['app_hash', 'api_hash', 'appHash', 'apiHash'];
const DC_KEYS = ['dc_id', 'dcId', 'telegram_dc_id'];
const DEVICE_KEYS = ['device', 'device_model', 'deviceModel'];
const SDK_KEYS = ['sdk', 'system_version', 'systemVersion'];
const APP_VERSION_KEYS = ['app_version', 'appVersion'];
/** Four separate tables, with no key shared between them. */
const LANG_PACK_KEYS = ['lang_pack', 'langPack'];
const LANG_CODE_KEYS = ['lang_code', 'langCode'];
const SYSTEM_LANG_PACK_KEYS = ['system_lang_pack', 'systemLangPack'];
const SYSTEM_LANG_CODE_KEYS = ['system_lang_code', 'systemLangCode'];
/** `telegram_password` is intentionally not here — see the module comment. */
const TWO_FA_KEYS = ['twoFA', 'two_fa', 'twofa', 'telegram_password_value', 'password'];
const FIRST_NAME_KEYS = ['first_name', 'firstName'];
const LAST_NAME_KEYS = ['last_name', 'lastName'];
const USERNAME_KEYS = ['username', 'user_name'];
/** `date` is not an alias here, tempting as it looks. */
const REGISTER_TIME_KEYS = ['register_time', 'registerTime'];

const KNOWN_KEYS = new Set([
  ...PHONE_KEYS,
  ...USER_ID_KEYS,
  ...API_ID_KEYS,
  ...API_HASH_KEYS,
  ...DC_KEYS,
  ...DEVICE_KEYS,
  ...SDK_KEYS,
  ...APP_VERSION_KEYS,
  ...LANG_PACK_KEYS,
  ...LANG_CODE_KEYS,
  ...SYSTEM_LANG_PACK_KEYS,
  ...SYSTEM_LANG_CODE_KEYS,
  ...TWO_FA_KEYS,
  ...FIRST_NAME_KEYS,
  ...LAST_NAME_KEYS,
  ...USERNAME_KEYS,
  ...REGISTER_TIME_KEYS,
  // Dropped rather than carried: it names the file this sidecar sits next.
  'session_file',
]);

const pickString = (src: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const v = src[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
};

const pickNumber = (src: Record<string, unknown>, keys: readonly string[]): number | null => {
  for (const key of keys) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
  }
  return null;
};

/** A generic `password` key is only a 2FA password when it does not look like the 0/1 flag some exporters put there. */
const pickTwoFa = (src: Record<string, unknown>): string | null => {
  const explicit = pickString(src, ['twoFA', 'two_fa', 'twofa', 'telegram_password_value']);
  if (explicit) return explicit;
  const loose = src.password;
  if (typeof loose !== 'string') return null;
  const trimmed = loose.trim();
  if (!trimmed || trimmed === '0' || trimmed === '1') return null;
  return trimmed;
};

const normalizePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  return digits ? `+${digits}` : raw;
};

export const parseTelegramSidecar = (raw: unknown): TelegramSidecar | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;

  /** A known key we could not make sense of is still not ours to throw away. */
  const unclaimed = new Set<string>();
  const field = <T>(keys: readonly string[], value: T | null): T | null => {
    if (value === null) {
      for (const key of keys) if (Object.hasOwn(src, key)) unclaimed.add(key);
    }
    return value;
  };

  const phone = field(PHONE_KEYS, pickString(src, PHONE_KEYS));
  const parsed = {
    phone: phone ? normalizePhone(phone) : null,
    userId: field(USER_ID_KEYS, pickNumber(src, USER_ID_KEYS)),
    apiId: field(API_ID_KEYS, pickNumber(src, API_ID_KEYS)),
    apiHash: field(API_HASH_KEYS, pickString(src, API_HASH_KEYS)),
    dcId: field(DC_KEYS, pickNumber(src, DC_KEYS)),
    device: field(DEVICE_KEYS, pickString(src, DEVICE_KEYS)),
    sdk: field(SDK_KEYS, pickString(src, SDK_KEYS)),
    appVersion: field(APP_VERSION_KEYS, pickString(src, APP_VERSION_KEYS)),
    langPack: field(LANG_PACK_KEYS, pickString(src, LANG_PACK_KEYS)),
    langCode: field(LANG_CODE_KEYS, pickString(src, LANG_CODE_KEYS)),
    systemLangPack: field(SYSTEM_LANG_PACK_KEYS, pickString(src, SYSTEM_LANG_PACK_KEYS)),
    systemLangCode: field(SYSTEM_LANG_CODE_KEYS, pickString(src, SYSTEM_LANG_CODE_KEYS)),
    twoFa: field(TWO_FA_KEYS, pickTwoFa(src)),
    firstName: field(FIRST_NAME_KEYS, pickString(src, FIRST_NAME_KEYS)),
    lastName: field(LAST_NAME_KEYS, pickString(src, LAST_NAME_KEYS)),
    username: field(USERNAME_KEYS, pickString(src, USERNAME_KEYS)),
    registerTime: field(REGISTER_TIME_KEYS, pickNumber(src, REGISTER_TIME_KEYS)),
  };

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (!KNOWN_KEYS.has(key) || unclaimed.has(key)) extra[key] = value;
  }
  return { ...parsed, extra };
};

export const parseTelegramSidecarJson = (text: string): TelegramSidecar | null => {
  try {
    return parseTelegramSidecar(JSON.parse(text));
  } catch {
    return null;
  }
};

/** Written back in the snake_case spelling the Telethon/Pyrogram tooling reads, with unrecognised keys reattached. */
export const serializeTelegramSidecar = (
  meta: TelegramSidecar,
  sessionFile?: string | null,
): string => {
  const out: Record<string, unknown> = { ...meta.extra };
  const put = (key: string, value: unknown): void => {
    if (value !== null && value !== undefined && value !== '') out[key] = value;
  };
  put('session_file', sessionFile ?? null);
  put('phone', meta.phone);
  put('id', meta.userId);
  put('user_id', meta.userId);
  put('app_id', meta.apiId);
  put('app_hash', meta.apiHash);
  put('dc_id', meta.dcId);
  put('device', meta.device);
  put('sdk', meta.sdk);
  put('app_version', meta.appVersion);
  put('lang_pack', meta.langPack);
  put('lang_code', meta.langCode);
  put('system_lang_pack', meta.systemLangPack);
  put('system_lang_code', meta.systemLangCode);
  put('twoFA', meta.twoFa);
  put('first_name', meta.firstName);
  put('last_name', meta.lastName);
  put('username', meta.username);
  put('register_time', meta.registerTime);
  return `${JSON.stringify(out, null, 2)}\n`;
};

export const emptySidecar = (): TelegramSidecar => ({
  phone: null,
  userId: null,
  apiId: null,
  apiHash: null,
  dcId: null,
  device: null,
  sdk: null,
  appVersion: null,
  langPack: null,
  langCode: null,
  systemLangPack: null,
  systemLangCode: null,
  twoFa: null,
  firstName: null,
  lastName: null,
  username: null,
  registerTime: null,
  extra: {},
});

const DEVICE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DEVICE_SUFFIXES = ['PRO', 'EXTREME', 'ELITE', 'PREMIUM'];

/** The device string the market checker invents for accounts it configures: 4-10 uppercase characters, a dash. */
const generateDeviceModel = (): string => {
  let head = '';
  for (let i = randomInt(4, 11); i > 0; i--) {
    head += DEVICE_ALPHABET.charAt(randomInt(DEVICE_ALPHABET.length));
  }
  const suffix = DEVICE_SUFFIXES[randomInt(DEVICE_SUFFIXES.length)] ?? 'PRO';
  return `${head}-${suffix}`;
};

/** What a Telegram Desktop client looks like on the wire, in the exact values the market's own `ClientConfig` defaults to. */
export const tdesktopSidecarDefaults = (): TelegramSidecar => ({
  ...emptySidecar(),
  apiId: 2040,
  apiHash: 'b18441a1ff607e10a989891a5462e627',
  device: generateDeviceModel(),
  sdk: 'Windows 10',
  appVersion: '7.0.5 x64',
  langPack: 'tdesktop',
  langCode: 'en',
  systemLangPack: 'en',
  systemLangCode: 'en',
});

/** Fills gaps in `base` from `patch`; never overwrites something already known. */
export const mergeSidecar = (
  base: TelegramSidecar | null,
  patch: Partial<TelegramSidecar>,
): TelegramSidecar => {
  const src = base ?? emptySidecar();
  const pick = <K extends keyof TelegramSidecar>(key: K): TelegramSidecar[K] =>
    (src[key] ?? patch[key] ?? null) as TelegramSidecar[K];

  const api = src.apiId !== null || src.apiHash !== null ? src : patch;
  const client = src.device !== null || src.sdk !== null || src.appVersion !== null ? src : patch;

  return {
    phone: pick('phone'),
    userId: pick('userId'),
    apiId: api.apiId ?? null,
    apiHash: api.apiHash ?? null,
    dcId: pick('dcId'),
    device: client.device ?? null,
    sdk: client.sdk ?? null,
    appVersion: client.appVersion ?? null,
    langPack: pick('langPack'),
    langCode: pick('langCode'),
    systemLangPack: pick('systemLangPack'),
    systemLangCode: pick('systemLangCode'),
    twoFa: pick('twoFa'),
    firstName: pick('firstName'),
    lastName: pick('lastName'),
    username: pick('username'),
    registerTime: pick('registerTime'),
    extra: { ...(patch.extra ?? {}), ...src.extra },
  };
};

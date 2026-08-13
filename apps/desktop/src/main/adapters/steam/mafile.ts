import { createHmac, randomUUID } from 'node:crypto';

const STEAM_ALPHABET = '23456789BCDFGHJKMNPQRTVWXY';

export const generateSteamGuardCode = (sharedSecretBase64: string, now = Date.now()): string => {
  const key = Buffer.from(sharedSecretBase64, 'base64');
  const time = BigInt(Math.floor(now / 1000 / 30));

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(time);

  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  let code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  let out = '';
  for (let i = 0; i < 5; i++) {
    out += STEAM_ALPHABET[code % STEAM_ALPHABET.length];
    code = Math.floor(code / STEAM_ALPHABET.length);
  }
  return out;
};

const SHARED_SECRET_KEYS = ['shared_secret', 'sharedSecret', 'SharedSecret'] as const;
const IDENTITY_SECRET_KEYS = ['identity_secret', 'identitySecret', 'IdentitySecret'] as const;
const DEVICE_ID_KEYS = ['device_id', 'deviceId', 'DeviceId', 'deviceid'] as const;
const ACCOUNT_NAME_KEYS = ['account_name', 'AccountName', 'accountName'] as const;
const REVOCATION_CODE_KEYS = ['revocation_code', 'RevocationCode', 'revocationCode'] as const;

const ENVELOPE_KEYS = ['maFile', 'mafile', 'MaFile'] as const;

const MAX_DEPTH = 4;

const asObject = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return asObject(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
};

const asText = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

const pick = (raw: unknown, keys: readonly string[], depth = 0): string | null => {
  const obj = asObject(raw);
  if (!obj || depth > MAX_DEPTH) return null;
  for (const key of keys) {
    const found = asText(obj[key]);
    if (found) return found;
  }
  for (const envelope of ENVELOPE_KEYS) {
    const found = pick(obj[envelope], keys, depth + 1);
    if (found) return found;
  }
  return null;
};

export const extractSharedSecret = (raw: unknown): string | null => pick(raw, SHARED_SECRET_KEYS);

export const extractAccountName = (raw: unknown): string | null => pick(raw, ACCOUNT_NAME_KEYS);

export const extractIdentitySecret = (raw: unknown): string | null =>
  pick(raw, IDENTITY_SECRET_KEYS);

export const extractDeviceId = (raw: unknown): string | null => pick(raw, DEVICE_ID_KEYS);

export const extractRevocationCode = (raw: unknown): string | null =>
  pick(raw, REVOCATION_CODE_KEYS);

export const generateDeviceId = (): string => `android:${randomUUID()}`;

const STEAM_ID_KEYS = ['steamid', 'SteamID', 'steamID', 'Steamid', 'steam_id', 'steamId'] as const;
const SESSION_KEYS = ['Session', 'session'] as const;
const STEAM_ID_IN_TEXT =
  /"(?:steamid|steam_id|steamID|SteamID|Steamid|steamId)"\s*:\s*"?(\d{17})"?/;

export const extractSteamId = (raw: unknown): string | null => {
  if (typeof raw === 'string') {
    const inText = raw.match(STEAM_ID_IN_TEXT);
    if (inText) return inText[1]!;
  }
  const direct = pick(raw, STEAM_ID_KEYS);
  if (direct) return direct;
  const obj = asObject(raw);
  if (!obj) return null;
  for (const key of SESSION_KEYS) {
    const found = pick(obj[key], STEAM_ID_KEYS);
    if (found) return found;
  }
  return null;
};

export interface MafileData {
  readonly sharedSecret: string | null;
  readonly identitySecret: string | null;
  readonly deviceId: string | null;
  readonly steamId: string | null;
  readonly accountName: string | null;
  readonly revocationCode: string | null;
}

export const parseMafile = (raw: unknown): MafileData => ({
  sharedSecret: extractSharedSecret(raw),
  identitySecret: extractIdentitySecret(raw),
  deviceId: extractDeviceId(raw),
  steamId: extractSteamId(raw),
  accountName: extractAccountName(raw),
  revocationCode: extractRevocationCode(raw),
});

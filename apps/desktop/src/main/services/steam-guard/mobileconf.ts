import { createHmac } from 'node:crypto';
import type { GuardConfirmation } from '@shared-types';

/** Steam's own names for what is being confirmed. */
export const CONFIRMATION_TYPE = {
  TRADE: 2,
  MARKET_LISTING: 3,
  ACCOUNT_RECOVERY: 6,
  API_KEY: 9,
  PURCHASE: 12,
} as const;

/** `base64(HMAC_SHA1(base64decode(identity_secret), be64(time) ‖ tag))`. */
export const confirmationHash = (identitySecret: string, time: number, tag: string): string => {
  const key = Buffer.from(identitySecret, 'base64');
  const tagBytes = Buffer.from(tag, 'utf8').subarray(0, 32);
  const message = Buffer.alloc(8 + tagBytes.length);
  message.writeBigUInt64BE(BigInt(Math.floor(time)), 0);
  tagBytes.copy(message, 8);
  return createHmac('sha1', key).update(message).digest('base64');
};

export interface ConfirmationQuery {
  readonly identitySecret: string;
  readonly steamId: string;
  readonly deviceId: string;
  readonly time: number;
  readonly tag: string;
}

/** The parameters every `/mobileconf` endpoint wants. */
export const confirmationParams = (query: ConfirmationQuery): URLSearchParams =>
  new URLSearchParams({
    p: query.deviceId,
    a: query.steamId,
    k: confirmationHash(query.identitySecret, query.time, query.tag),
    t: String(query.time),
    m: 'react',
    tag: query.tag,
  });

export type ConfirmationListResult =
  | { ok: true; confirmations: GuardConfirmation[] }
  | { ok: false; needAuth: boolean; message: string | null };

const asString = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

const asSummary = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(asString).filter((line) => line.length > 0) : [];

const parseOne = (v: unknown): GuardConfirmation | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const id = asString(r.id);
  const nonce = asString(r.nonce);
  if (!id || !nonce) return null;
  const type = Number(r.type);
  return {
    id,
    nonce,
    creatorId: asString(r.creator_id),
    type: Number.isFinite(type) ? type : 0,
    typeName: asString(r.type_name),
    headline: asString(r.headline),
    summary: asSummary(r.summary),
    icon: asString(r.icon),
    warning: asString(r.warn) || null,
    creationTime: Number(r.creation_time) || 0,
  };
};

/** Reads a `getlist` body. */
export const parseConfirmationList = (body: string): ConfirmationListResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // An HTML login page rather than JSON: the session is gone.
    return { ok: false, needAuth: true, message: null };
  }
  const r = (parsed ?? {}) as Record<string, unknown>;
  if (r.success !== true) {
    return {
      ok: false,
      needAuth: r.needauth === true || r.needsauth === true,
      message: asString(r.message) || null,
    };
  }
  const list = Array.isArray(r.conf) ? r.conf : [];
  return {
    ok: true,
    confirmations: list.map(parseOne).filter((c): c is GuardConfirmation => c !== null),
  };
};

/** Reads an `ajaxop` / `multiajaxop` body. */
export const parseConfirmationOp = (
  body: string,
): { ok: true } | { ok: false; needAuth: boolean; message: string | null } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, needAuth: true, message: null };
  }
  const r = (parsed ?? {}) as Record<string, unknown>;
  if (r.success === true) return { ok: true };
  return {
    ok: false,
    needAuth: r.needauth === true || r.needsauth === true,
    message: asString(r.message) || null,
  };
};

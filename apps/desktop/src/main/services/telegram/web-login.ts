/** `SESSION_ACCOUNT_PREFIX` + slot; an unset slot reads as 1. */
const SLOT_KEY = 'account1';

/** `SESSION_LEGACY_USER_KEY`. */
const LEGACY_USER_KEY = 'user_auth';

/** Keys a previous attempt may have left in this partition that would change how the client boots. */
export const STALE_KEYS = ['kz_version', 'tt-is-screen-locked'] as const;

export interface WebSessionParams {
  /** 512 hex chars — the 256-byte MTProto auth key. */
  readonly authKeyHex: string;
  /** Production DC the key belongs to, 1..5. */
  readonly dcId: number;
  /** Telegram user id. */
  readonly userId: number;
}

/** The exact `localStorage` entries Web A expects, values already serialized the way the client writes them. */
export const buildWebAStorage = (params: WebSessionParams): Record<string, string> => {
  const authKey = params.authKeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{512}$/.test(authKey)) {
    throw new Error(`auth_key должен быть 512 hex-символов, получено ${params.authKeyHex.length}`);
  }
  if (!Number.isInteger(params.dcId) || params.dcId < 1 || params.dcId > 5) {
    throw new Error(`Неизвестный DC id: ${params.dcId}`);
  }
  if (!Number.isInteger(params.userId) || params.userId <= 0) {
    throw new Error('Для входа через браузер нужен user id аккаунта');
  }

  const authKeyKey = `dc${params.dcId}_auth_key`;
  // Web A carries the user id around as a string.
  const userId = String(params.userId);

  return {
    [SLOT_KEY]: JSON.stringify({ dcId: params.dcId, [authKeyKey]: authKey, userId }),
    [LEGACY_USER_KEY]: JSON.stringify({ dcID: params.dcId, id: userId, test: false }),
    dc: String(params.dcId),
    [authKeyKey]: JSON.stringify(authKey),
  };
};

/** The one-shot script that plants the session. */
export const buildWebInjectionScript = (entries: Record<string, string>): string => {
  const pairs = JSON.stringify(Object.entries(entries));
  const stale = JSON.stringify(STALE_KEYS);
  return `(() => {
    try {
      if (!/(^|\\.)telegram\\.org$/.test(location.hostname)) return;
      if (sessionStorage.getItem('__lzt_tg_injected') === '1') return;
      sessionStorage.setItem('__lzt_tg_injected', '1');
      for (const key of ${stale}) localStorage.removeItem(key);
      for (const [key, value] of ${pairs}) localStorage.setItem(key, value);
    } catch (err) {
      console.error('[lzt] telegram web injection failed', err);
    }
  })()`;
};

export const TELEGRAM_WEB_URL = 'https://web.telegram.org/a/';

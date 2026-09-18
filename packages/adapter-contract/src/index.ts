import type {
  AccountDetails,
  LauncherSettings,
  ProxyEntry,
  ServiceId,
} from '@lolzteam/shared-types';

// Re-exported so adapters and the renderer share one definition with the service registry instead of keeping a parallel.
export type { LoginMethod } from '@lolzteam/shared-types';
import type { LoginMethod } from '@lolzteam/shared-types';

export type ProbeResult = { available: true } | { available: false; reason: string };

/**
 * A user-facing string the main process cannot render itself — it has no
 * locale. `key` is an i18n key, `params` its interpolation values; the
 * renderer turns it into text with `t(key, params)`.
 */
export interface LocalizedText {
  key: string;
  params?: Record<string, string | number>;
}

export interface LoginResult {
  ok: boolean;
  method: LoginMethod;
  message?: LocalizedText;
  launchedPid?: number;
  windowId?: number;
}

export interface AdapterLogger {
  debug: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
}

export interface AppPaths {
  userData: string;
  logs: string;
  temp: string;
}

export type LoginStep =
  | 'fetching-credentials'
  | 'done'
  // steam
  | 'acquiring-token'
  | 'awaiting-email-code'
  | 'fetching-email-code'
  /** Signing Steam's mobile confirmation with the account's own linked Guard. */
  | 'approving-device-confirm'
  | 'killing-steam'
  | 'writing-vdf'
  | 'encrypting-token'
  | 'launching-steam'
  // telegram
  | 'building-tdata'
  | 'killing-telegram'
  | 'writing-tdata'
  | 'launching-telegram'
  // browser (cookie injection)
  | 'injecting-cookies'
  | 'launching-browser'
  // discord (token injection)
  | 'injecting-token'
  // ea desktop
  | 'killing-ea'
  | 'writing-ea-session'
  | 'launching-ea';

/**
 * A sub-label under a step, naming the path the flow took. It is a key the
 * renderer translates (`loginDetails.<key>`), not prose — the main process
 * has no locale, so it must never emit a user-facing string of its own.
 */
export type LoginDetail =
  | 'with-email-code'
  | 'requesting-guard-code'
  | 'guard-from-item'
  | 'guard-from-sda'
  | 'guard-from-market'
  | 'guard-from-mafile';

export interface LoginProgressEvent {
  step: LoginStep;
  detailKey?: LoginDetail;
}

/** What the market's guard-code endpoint came back with. */
export interface GuardCodeAnswer {
  code: string | null;
  /** The item carries no maFile on the market — a download would fail the same way. */
  noMafile: boolean;
}

export interface AdapterContext {
  log: AdapterLogger;
  paths: AppPaths;
  abortSignal: AbortSignal;
  onProgress?: (event: LoginProgressEvent) => void;
  fetchEmailCode?: (itemId: number) => Promise<string | null>;
  /**
   * Fetches the Steam Guard mafile `shared_secret`. Cancels the item's active
   * guarantee on the market's side — callers must ask the user first via
   * `confirmMafileDownload`.
   */
  fetchSteamMafile?: (itemId: number) => Promise<string | null>;
  /**
   * One Steam Guard TOTP straight from the market, generated from the maFile
   * it holds — without touching the item's guarantee. `noMafile` says the
   * market has no maFile for the item at all, so there is nothing to ask about.
   */
  fetchSteamGuardCode?: (itemId: number) => Promise<GuardCodeAnswer>;
  /** The user's yes to the guarantee-cancelling mafile download; absent means «ask nobody, refuse». */
  confirmMafileDownload?: (itemId: number) => Promise<boolean>;
  settings?: LauncherSettings;
  proxy?: ProxyEntry;
  proxyTest?: { ip: string; ms: number };
}

export interface ServiceAdapter {
  readonly id: ServiceId;
  readonly displayName: string;
  readonly platforms: readonly NodeJS.Platform[];
  readonly methods: readonly LoginMethod[];

  probe(method: LoginMethod, ctx: AdapterContext): Promise<ProbeResult>;
  login(method: LoginMethod, account: AccountDetails, ctx: AdapterContext): Promise<LoginResult>;
}

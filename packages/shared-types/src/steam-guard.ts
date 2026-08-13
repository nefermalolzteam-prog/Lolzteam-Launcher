export type GuardFailureReason =
  | 'no_account'
  | 'no_credentials'
  | 'not_linked'
  | 'session_expired'
  /** We never reached Steam: a timeout, a dead proxy, no route out. */
  | 'network'
  | 'needs_email_code'
  | 'login_failed'
  | 'bad_qr'
  /** Confirmations only. */
  | 'no_identity_secret'
  /** Steam answered, but refused — usually its own transient "Oh nooooooes!". */
  | 'steam_error';

export interface GuardStatus {
  readonly accountId: number;
  /** A mobile session exists, so codes and login approval work. */
  readonly linked: boolean;
  readonly steamId: string;
  readonly accountName: string;
  /** Codes can be generated. */
  readonly hasSharedSecret: boolean;
  /** Trade and market confirmations are available. */
  readonly hasIdentitySecret: boolean;
  readonly proxyId: string | null;
  readonly linkedAt: number | null;
}

export interface GuardCodeResult {
  readonly code: string;
  readonly secondsRemaining: number;
  /** Steam's clock, in seconds — lets the UI keep counting without re-asking. */
  readonly generatedAt: number;
}

/** What is being approved, shown before the user can say yes. */
export interface GuardAuthSessionInfo {
  readonly ip: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly deviceFriendlyName: string;
  readonly platformType: number;
  /** Steam's own judgement that the request came from somewhere unusual. */
  readonly locationMismatch: boolean;
  readonly highUsageLogin: boolean;
}

/** One display, grabbed for QR scanning. */
export interface ScreenCapture {
  readonly id: string;
  readonly name: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

/** One pending mobile confirmation. */
export interface GuardConfirmation {
  readonly id: string;
  readonly nonce: string;
  readonly creatorId: string;
  /** 2 = trade, 3 = market listing, 6 = account recovery, 9 = API key, 12 = purchase. */
  readonly type: number;
  readonly typeName: string;
  readonly headline: string;
  readonly summary: readonly string[];
  readonly icon: string;
  readonly warning: string | null;
  readonly creationTime: number;
}

export type GuardConfirmationAction = 'allow' | 'cancel';

export type GuardResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: GuardFailureReason; message?: string };

/** Attaching the authenticator to every selected account. */
export interface SteamLinkRequest {
  readonly accountIds: readonly number[];
  readonly proxyIds: readonly string[];
}

/** What one account's linking came to. */
export interface SteamLinkResult {
  /** Steam's own name for the account, as the session reported it. */
  readonly accountName: string;
  /** It was already linked, so nothing was signed in. */
  readonly already: boolean;
}

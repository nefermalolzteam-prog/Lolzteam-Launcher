import type { SupportedServiceId } from './service-registry';

/** Tied to the registry: dropping `steam` from `SERVICES` breaks compilation. */
export type LocalServiceId = Extract<SupportedServiceId, 'steam' | 'telegram'>;

export const LOCAL_SERVICE_IDS: readonly LocalServiceId[] = ['steam', 'telegram'];

export const isLocalServiceId = (v: unknown): v is LocalServiceId =>
  typeof v === 'string' && (LOCAL_SERVICE_IDS as readonly string[]).includes(v);

interface LocalAccountCommon {
  /** Negative by construction, so it can never collide with a market item id. */
  readonly id: number;
  /** User-supplied title shown on the card. */
  readonly label: string;
  /** Ids of the user's own labels hung on this account — see {@link LocalLabel}. */
  readonly labels: readonly number[];
  /** The market item this account was copied from, or `null` when it was typed in by hand. */
  readonly marketItemId: number | null;
  /** Unix **milliseconds** (`Date.now()`) — the projection converts to seconds. */
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A label the user invented for their own accounts. */
export interface LocalLabel {
  readonly id: number;
  readonly title: string;
  /** Background colour as `#rrggbb` — the field name the market's tags use. */
  readonly bc: string;
}

export type LocalLabelResult =
  | { ok: true; labels: LocalLabel[] }
  | { ok: false; message: 'empty_title' | 'not_found' | 'store_unreadable' | 'write_failed' };

export interface LocalSteamRecord extends LocalAccountCommon {
  readonly service: 'steam';
  readonly login: string;
  readonly password: string;
  /** Steam Guard TOTP secret (base64), or null when the account has no guard. */
  readonly sharedSecret: string | null;
  /** Signs trade and market confirmations (base64), or null. */
  readonly identitySecret: string | null;
  /** The `android:<uuid>` the maFile was issued with, or null. */
  readonly deviceId: string | null;
}

export interface LocalTelegramRecord extends LocalAccountCommon {
  readonly service: 'telegram';
  /** 512 hex chars (256 bytes). */
  readonly authKey: string;
  /** Production data centre, 1..5. */
  readonly dcId: number;
  readonly phone: string | null;
  readonly userId: number | null;
}

/** Discriminated on `service` so the projection never needs a non-null assertion. */
export type LocalAccountRecord = LocalSteamRecord | LocalTelegramRecord;

/** Raw form values. */
export interface LocalSteamInput {
  readonly service: 'steam';
  readonly label: string;
  readonly login: string;
  /** Empty on update = keep the stored password. */
  readonly password: string;
  /** Full maFile JSON, `{maFile:{…}}`, or a bare shared_secret. */
  readonly guard: string;
  /** Update only: drop the stored guard secret ("empty = keep" cannot clear). */
  readonly clearGuard?: boolean;
}

export interface LocalTelegramInput {
  readonly service: 'telegram';
  readonly label: string;
  /** 512 hex chars, optionally suffixed `:<dc>`. */
  readonly authKey: string;
  /** 1..5. Overridden by the `:<dc>` suffix of `authKey` when present. */
  readonly dcId: string;
  readonly phone: string;
  readonly userId: string;
  /** Claim ticket from `telegram:identify`, when the key came out of a container. */
  readonly sessionToken?: string;
}

export type LocalAccountInput = LocalSteamInput | LocalTelegramInput;

/** What the edit form is allowed to see: non-secret fields plus a flag telling the user whether a secret is on file. */
export type LocalAccountEdit =
  | {
      readonly id: number;
      readonly service: 'steam';
      readonly label: string;
      readonly login: string;
      readonly hasSharedSecret: boolean;
      /** Whether the stored maFile can sign confirmations too. */
      readonly hasIdentitySecret: boolean;
    }
  | {
      readonly id: number;
      readonly service: 'telegram';
      readonly label: string;
      readonly dcId: number;
      readonly phone: string | null;
      readonly userId: number | null;
      readonly hasAuthKey: boolean;
    };

export type LocalAccountResult = { ok: true; id: number } | { ok: false; message: string };

/** Result of asking the OS to show an account's folder. */
export type RevealFolderResult =
  | { ok: true; dir: string }
  | { ok: false; message: 'not_found' | 'failed' };

/** What to do when the folder the user picked already holds a database. */
export type LocalDbMoveMode = 'move' | 'adopt' | 'replace';

export type LocalDbSetDirResult =
  | { ok: true; dir: string | null }
  | { ok: false; reason: 'target_exists' | 'not_writable' | 'move_failed' | 'same_dir' };

/** One database folder, as the switcher lists it. */
export interface LocalDbEntry {
  /** What `localDbDir` becomes if this one is opened; `null` is the app's own folder. */
  dir: string | null;
  /** Where that lands on disk — the path the user is shown. */
  path: string;
  /** The base being read right now. */
  current: boolean;
  /** False when the folder is not there: a drive unplugged, a folder renamed. */
  available: boolean;
  /** Accounts found per service, or `null` when the folder could not be read. */
  counts: Record<LocalServiceId, number> | null;
}

/** `missing` is the answer that matters: a base on a stick that is not plugged in must not be opened. */
export type LocalDbSwitchResult =
  | { ok: true; dir: string | null }
  | { ok: false; reason: 'missing' | 'not_writable' };

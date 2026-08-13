import type { SteamCheckInfo } from './steam-check';
import type { SteamFriendsResult } from './steam-friends';
import type { SteamLinkResult } from './steam-guard';

/** Every session container the converter understands, in both directions. */
export type TelegramSessionFormat =
  | 'tdata'
  | 'telethon-session'
  | 'pyrogram-session'
  | 'telethon-string'
  | 'pyrogram-string'
  | 'gramjs-string'
  | 'mtkruto-string'
  | 'mtcute-string'
  | 'json';

/** Formats the converter can produce. */
export const TELEGRAM_CONVERT_TARGETS = [
  'tdata',
  'telethon-session',
  'pyrogram-session',
  'telethon-string',
  'pyrogram-string',
  'gramjs-string',
  'mtkruto-string',
  'mtcute-string',
] as const satisfies readonly TelegramSessionFormat[];

export type TelegramConvertTarget = (typeof TELEGRAM_CONVERT_TARGETS)[number];

/** Why an entry cannot be converted. */
export type TelegramConvertProblem =
  | 'unreadable'
  | 'unknown_format'
  | 'bad_auth_key'
  | 'unknown_dc'
  | 'empty';

/** One recognised item in the source folder, as shown in the preview table. */
export interface TelegramConvertEntry {
  /** Stable within one scan; what `convert-run` refers back to. */
  readonly id: string;
  /** Absolute path of the file or directory this entry was read from. */
  readonly path: string;
  /** Display name, relative to the scanned folder. */
  readonly name: string;
  readonly format: TelegramSessionFormat;
  readonly dcId: number | null;
  readonly userId: number | null;
  readonly phone: string | null;
  /** A `.json` sidecar was found and its metadata will be carried over. */
  readonly hasMeta: boolean;
  readonly problem: TelegramConvertProblem | null;
  /** Free-form detail behind `problem`, for the tooltip. */
  readonly problemDetail: string | null;
}

export interface TelegramConvertScan {
  readonly dir: string;
  readonly entries: readonly TelegramConvertEntry[];
  /** Names skipped outright (not a session, not a tdata). */
  readonly skipped: number;
}

export interface TelegramConvertItemResult {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  /** Absolute path of what was written. */
  readonly output: string | null;
  readonly error: string | null;
}

export interface TelegramConvertRunResult {
  readonly outDir: string;
  readonly items: readonly TelegramConvertItemResult[];
  readonly converted: number;
  readonly failed: number;
}

/** What a pasted or picked container turned out to hold, for the "add one account" form. */
export interface TelegramIdentified {
  readonly token: string;
  readonly format: TelegramSessionFormat;
  readonly dcId: number;
  readonly userId: number | null;
  readonly phone: string | null;
  /** Suggested label: the phone, else the user id, else the tail of the key. */
  readonly title: string;
  /** Further accounts in the same container — offer the bulk import instead. */
  readonly more: number;
  /** Folder those further accounts live in, to hand straight to the import. */
  readonly dir: string | null;
}

export type TelegramIdentifyResult =
  | { ok: true; identified: TelegramIdentified }
  | { ok: false; reason: TelegramConvertProblem };

/** What became of the account, not of the task. */
export type TelegramCheckStatus = 'alive' | 'frozen' | 'dead';

export const TELEGRAM_SPAM_STATUSES = ['free', 'geo', 'limited', 'blocked', 'unknown'] as const;

export type TelegramSpamStatus = (typeof TELEGRAM_SPAM_STATUSES)[number];

export const isTelegramSpamStatus = (v: unknown): v is TelegramSpamStatus =>
  typeof v === 'string' && (TELEGRAM_SPAM_STATUSES as readonly string[]).includes(v);

export interface TelegramSpamVerdict {
  readonly status: TelegramSpamStatus;
  /** Epoch ms the restriction lifts, when the bot named a date. */
  readonly until: number | null;
}

export interface TelegramCheckInfo {
  readonly status: TelegramCheckStatus;
  readonly userId: number | null;
  readonly phone: string | null;
  readonly username: string | null;
  readonly name: string;
  readonly premium: boolean;
  /** ISO-2 country of the phone number, when we could tell. */
  readonly country: string | null;
  /** `null` when the spam probe was not asked for — it is opt-in on purpose. */
  readonly spam: TelegramSpamVerdict | null;
  /** Active authorizations, when asked for. */
  readonly sessions: number | null;
  /** Telegram's own words behind `dead`/`frozen`/`error`. */
  readonly detail: string | null;
}

/** Whether the check got far enough to see the account at all. */
export const telegramCheckSawAccount = (info: Pick<TelegramCheckInfo, 'userId'>): boolean =>
  info.userId !== null;

/** The last thing a check learned about an account, kept on disk. */
export interface TelegramProfile {
  readonly accountId: number;
  readonly status: TelegramCheckStatus;
  readonly userId: number | null;
  readonly phone: string | null;
  readonly username: string | null;
  readonly name: string;
  readonly premium: boolean;
  readonly country: string | null;
  readonly spam: TelegramSpamVerdict | null;
  readonly sessions: number | null;
  readonly hasAvatar: boolean;
  /** Epoch ms of the check that produced this. */
  readonly checkedAt: number;
  readonly detail: string | null;
}

/** Which half of the name pool to draw from. */
export type TelegramGender = 'male' | 'female' | 'mixed';

/** Which language the generated name and bio are written in. */
export type TelegramNameLocale = 'ru' | 'en' | 'mixed';

/** What a fill actually put on the account. */
export interface TelegramProfileFill {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly bio: string | null;
  /** File name of the picture that was uploaded, for the row. */
  readonly avatar: string | null;
  /** The picture was a video — Telegram shows it animated. */
  readonly animated: boolean;
}

/** One avatar folder, as the modal describes it before a run. */
export interface TelegramAvatarPack {
  readonly dir: string;
  readonly photos: number;
  readonly videos: number;
  readonly male: number;
  readonly female: number;
  readonly error: 'unreadable' | 'empty' | null;
}

export interface TelegramProfileRequest {
  readonly accountIds: readonly number[];
  readonly gender: TelegramGender;
  readonly locale: TelegramNameLocale;
  /** Generate a first and last name. */
  readonly withName: boolean;
  /** Generate a short bio (max 70 chars, Telegram's own limit). */
  readonly withBio: boolean;
  /** Folder to draw pictures from, or `null` to leave the photo alone. */
  readonly avatarDir: string | null;
  /** Delete the pictures already on the account instead of stacking a new one on top. */
  readonly replaceAvatar: boolean;
  readonly proxyIds: readonly string[];
}

/** What a cleanup is allowed to touch. */
export type TelegramCleanupTarget =
  | 'channels'
  | 'groups'
  | 'bots'
  | 'private'
  | 'saved'
  | 'service'
  | 'folders'
  | 'contacts';

export const TELEGRAM_CLEANUP_TARGETS = [
  'channels',
  'groups',
  'bots',
  'private',
  'saved',
  'service',
  'folders',
  'contacts',
] as const satisfies readonly TelegramCleanupTarget[];

export interface TelegramCleanupRequest {
  readonly accountIds: readonly number[];
  /** Nothing selected is refused as `empty`: a run that would do nothing. */
  readonly targets: readonly TelegramCleanupTarget[];
  /** Also walk the archive. */
  readonly includeArchived: boolean;
  /** Delete private correspondence on the other side too, not only ours. */
  readonly revokePrivate: boolean;
  readonly proxyIds: readonly string[];
}

/** What one account's cleanup came to. */
export interface TelegramCleanupResult {
  /** Dialogs looked at, including the ones deliberately kept. */
  readonly scanned: number;
  /** Groups and channels the account walked out of. */
  readonly left: number;
  /** Conversations removed from the list. */
  readonly deleted: number;
  /** People dropped from the address book. */
  readonly contacts: number;
  /** Chat folders removed. */
  readonly folders: number;
  readonly failed: number;
}

/** The privacy switches the panel offers, named after what the user sees in Telegram rather than after the TL key behind. */
export type TelegramPrivacyKey =
  | 'lastSeen'
  | 'profilePhoto'
  | 'phone'
  | 'forwards'
  | 'calls'
  | 'groups'
  | 'voices'
  | 'bio'
  | 'birthday';

export const TELEGRAM_PRIVACY_KEYS = [
  'lastSeen',
  'profilePhoto',
  'phone',
  'forwards',
  'calls',
  'groups',
  'voices',
  'bio',
  'birthday',
] as const satisfies readonly TelegramPrivacyKey[];

/** Telegram's three answers. */
export type TelegramPrivacyValue = 'everybody' | 'contacts' | 'nobody';

/** The switches Telegram only honours on a Premium account. */
export const TELEGRAM_PRIVACY_PREMIUM_ONLY: readonly TelegramPrivacyKey[] = ['voices'];

export interface TelegramPrivacyRequest {
  readonly accountIds: readonly number[];
  /** Only the keys the user actually chose. */
  readonly rules: Readonly<Partial<Record<TelegramPrivacyKey, TelegramPrivacyValue>>>;
  readonly proxyIds: readonly string[];
}

export interface TelegramPrivacyResult {
  readonly applied: readonly TelegramPrivacyKey[];
  readonly failed: readonly TelegramPrivacyKey[];
  /** Refused because the account has no Premium. */
  readonly needsPremium: readonly TelegramPrivacyKey[];
}

/* ------------------------------------------------------------------ *
 * The queue itself.
 * ------------------------------------------------------------------ */

/** Which mass operation a run belongs to. */
export type TelegramTaskKind =
  | 'check'
  | 'profile'
  | 'cleanup'
  | 'privacy'
  | 'steam-check'
  | 'steam-friends'
  | 'steam-link';

export type TelegramTaskState = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

/** Where inside one account's turn the runner currently is. */
export type TelegramTaskStep =
  | 'resolving'
  | 'connecting'
  | 'me'
  | 'spam'
  | 'sessions'
  | 'avatar'
  | 'name'
  | 'photo'
  /** Reading the dialog list — the slow half of a cleanup. */
  | 'dialogs'
  /** Leaving and deleting what the scan picked out. */
  | 'leaving'
  /** Emptying the address book. */
  | 'contacts'
  /** Removing the chat folders the previous owner arranged. */
  | 'folders'
  /** Writing the privacy rules. */
  | 'privacy'
  /** Reading a Steam account's friends list. */
  | 'friends'
  /** Unfriending and blocking what the list turned up. */
  | 'purging'
  /** Signing in as the mobile app to attach the authenticator. */
  | 'linking'
  | 'waiting';

/** Why a row failed. */
export type TelegramTaskError =
  | 'no_account'
  | 'not_telegram'
  | 'no_auth_key'
  | 'bad_auth_key'
  /** A bought item, not a record in the base. */
  | 'not_in_base'
  /** The account has no Steam Guard session in the launcher, so nothing can be asked of Steam on its behalf. */
  | 'not_linked'
  /** The session is there and Steam turned it down — logged out everywhere, or the authenticator was moved. */
  | 'session_refused'
  /** There is nothing to link with: no `shared_secret` on the account, or no login and password to sign in with. */
  | 'no_credentials'
  /** Steam wants a code from the account's mailbox before it will let the mobile app in. */
  | 'needs_email_code'
  | 'no_avatars'
  | 'flood_wait'
  | 'network'
  | 'cancelled'
  | 'unknown';

export interface TelegramTaskRow {
  readonly accountId: number;
  readonly state: TelegramTaskState;
  readonly step: TelegramTaskStep | null;
  readonly check: TelegramCheckInfo | null;
  /** What a Steam check learned. */
  readonly steam: SteamCheckInfo | null;
  /** What a profile run wrote to the account. */
  readonly filled: TelegramProfileFill | null;
  /** What a cleanup removed. */
  readonly cleaned: TelegramCleanupResult | null;
  /** Which privacy rules went through. */
  readonly privacy: TelegramPrivacyResult | null;
  /** What a Steam friends purge dropped. */
  readonly friends: SteamFriendsResult | null;
  /** What a mass Steam Guard link did. */
  readonly link: SteamLinkResult | null;
  readonly error: TelegramTaskError | null;
  /** Free-form detail behind `error`, for the tooltip. */
  readonly detail: string | null;
  /** Seconds Telegram asked us to wait; the row retries itself after them. */
  readonly waitSeconds: number | null;
}

/** Why a run ended before its list did. */
export type TelegramRunStop = 'cancelled' | 'too_many_failures' | 'internal_error';

export interface TelegramRunSummary {
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  /** Items the run never reached. */
  readonly skipped: number;
  /** Why the run ended before its list did, if it did. */
  readonly stopped: TelegramRunStop | null;
}

/** One progress tick. */
export interface TelegramTaskEvent {
  readonly runId: string;
  readonly kind: TelegramTaskKind;
  readonly row: TelegramTaskRow | null;
  readonly summary: TelegramRunSummary | null;
}

export interface TelegramCheckRequest {
  readonly accountIds: readonly number[];
  /** Ask @SpamBot as well. */
  readonly withSpam: boolean;
  /** Also count the account's active authorizations. */
  readonly withSessions: boolean;
  /** Download the profile picture as well. */
  readonly withAvatar: boolean;
  /** Proxies to spread the run across: empty = straight out, one = everything through it, several = round-robin. */
  readonly proxyIds: readonly string[];
}

export type TelegramRunStart =
  | { ok: true; runId: string }
  /** `no_avatars`: the folder was picked, but nothing usable is in it any more. */
  | { ok: false; reason: 'busy' | 'empty' | 'no_avatars' };

import type { LoginProgressEvent } from '@lolzteam/adapter-contract';
import type {
  AccountPreview,
  AccountSummary,
  AccountTag,
  ActionDraft,
  ActionEntry,
  AuthStatus,
  AuthTokenPayload,
  DesktopNotification,
  GuardAuthSessionInfo,
  GuardCodeResult,
  GuardConfirmation,
  GuardConfirmationAction,
  GuardResult,
  GuardStatus,
  LauncherSettings,
  LocalAccountEdit,
  LocalAccountInput,
  LocalAccountResult,
  LocalDbEntry,
  LocalDbMoveMode,
  LocalDbSetDirResult,
  LocalDbSwitchResult,
  LocalImportCommitRequest,
  LocalImportCommitResult,
  LocalImportPreviewResult,
  LocalImportRequest,
  LocalLabel,
  LocalLabelResult,
  LocalServiceId,
  MailCredentials,
  MailLettersRequest,
  MailLettersResult,
  MarketCurrency,
  MarketScope,
  MetricsState,
  PickFileOptions,
  ProxyEntry,
  RevealFolderResult,
  ScreenCapture,
  ServiceId,
  SettingsResponse,
  SteamCheckRecord,
  SteamCheckRequest,
  SteamFriendsRequest,
  SteamLinkRequest,
  TelegramAvatarPack,
  TelegramCheckRequest,
  TelegramCleanupRequest,
  TelegramConvertRunResult,
  TelegramConvertScan,
  TelegramConvertTarget,
  TelegramIdentifyResult,
  TelegramPrivacyRequest,
  TelegramProfile,
  TelegramProfileRequest,
  TelegramRunStart,
  TelegramTaskEvent,
  UserLabel,
} from '@lolzteam/shared-types';

export type LoginProgress = LoginProgressEvent & { itemId: number };

export type TagOpResult = { ok: true } | { ok: false; message: string };

/** What the note now says, as the market has it. */
export type NoteOpResult = { ok: true; note: string | null } | { ok: false; message: string };

/** What came of a hand-typed API token. */
export type AuthTokenSubmitResult =
  | { ok: true }
  /** The field was blank, or nothing but whitespace. */
  | { ok: false; reason: 'empty' }
  /** The market answered, and the answer was «this token is not valid». */
  | { ok: false; reason: 'rejected' }
  /** The market did not answer. */
  | { ok: false; reason: 'offline' };

export type LabelMutationResult =
  | { ok: true; labels: UserLabel[] }
  | { ok: false; message: string };

export interface AccountsCategoryEvent {
  streamId: number;
  serviceId: ServiceId;
  /** Streaming only ever serves the market — local accounts are not paged. */
  scope: MarketScope;
  items: AccountSummary[];
  categoryDone: boolean;
  done: boolean;
  page?: number;
  totalPages?: number | null;
  /** The category gave up: the request threw, or the walk stopped part-way through the pages. */
  failed?: boolean;
}

/** What is on disk right now, without reading it. */
export interface AccountsCacheStatus {
  hasCache: boolean;
  /** Unix milliseconds of the last successful write, or `null` if there is none. */
  fetchedAt: number | null;
  count: number;
}

export type CheckAccountResult =
  | { ok: true; valid: boolean; tags: AccountTag[]; reason?: string }
  | { ok: false; message: string };

export type ProxyTestResult = { ok: true; ms: number; ip: string } | { ok: false; message: string };

export interface ProxyTestInfo {
  ip: string;
  ms: number;
}

export interface BrowserNavState {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  title: string;
}

export type NetworkStatus = { online: true; ms: number } | { online: false; message: string };

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string; notes: string | null }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number; transferred: number; total: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export const IPC_CHANNELS = {
  AUTH_OPEN_IN_APP: 'auth:open-in-app',
  AUTH_OPEN_BROWSER: 'auth:open-browser',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_STATUS: 'auth:get-status',
  AUTH_SUBMIT_TOKEN: 'auth:submit-token',
  AUTH_TOKEN_RECEIVED: 'auth:token-received',
  AUTH_STATUS_CHANGED: 'auth:status-changed',

  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_LIST_STREAM: 'accounts:list-stream',
  ACCOUNTS_CATEGORY: 'accounts:category',
  ACCOUNTS_REFRESH: 'accounts:refresh',
  ACCOUNTS_CLEAR_CACHE: 'accounts:clear-cache',
  ACCOUNTS_CACHE_STATUS: 'accounts:cache-status',
  ACCOUNTS_GET_PREVIEW: 'accounts:get-preview',
  ACCOUNTS_GET_MAIL: 'accounts:get-mail',
  ACCOUNT_LOGIN: 'account:login',
  ACCOUNT_LOGIN_CANCEL: 'account:login-cancel',
  ACCOUNT_LOGIN_PROGRESS: 'account:login-progress',
  ACCOUNT_LOGIN_REQUEST: 'account:login-request',
  ACCOUNT_CHECK: 'account:check',
  ACCOUNT_ADD_TAG: 'account:add-tag',
  ACCOUNT_REMOVE_TAG: 'account:remove-tag',
  ACCOUNT_SET_NOTE: 'account:set-note',

  LOCAL_ACCOUNT_CREATE: 'local-account:create',
  /** Copy a bought account into the local base. */
  LOCAL_ACCOUNT_FROM_MARKET: 'local-account:from-market',
  LOCAL_ACCOUNT_UPDATE: 'local-account:update',
  LOCAL_ACCOUNT_DELETE: 'local-account:delete',
  LOCAL_ACCOUNT_FORM: 'local-account:form',
  LOCAL_ACCOUNT_IMPORT_PREVIEW: 'local-account:import-preview',
  LOCAL_ACCOUNT_IMPORT_COMMIT: 'local-account:import-commit',
  LOCAL_ACCOUNT_REVEAL: 'local-account:reveal',
  /** Move an account into one of the user's folders inside the base. */
  LOCAL_ACCOUNT_MOVE: 'local-account:move',
  /** Folders that exist per service, including ones holding no accounts yet. */
  LOCAL_ACCOUNT_GROUPS: 'local-account:groups',
  /** Replace the whole set of labels on one account. */
  LOCAL_ACCOUNT_LABELS: 'local-account:labels',
  LOCAL_LABEL_LIST: 'local-label:list',
  LOCAL_LABEL_SAVE: 'local-label:save',
  LOCAL_LABEL_DELETE: 'local-label:delete',
  LOCAL_DB_PICK_DIR: 'local-db:pick-dir',
  /** Take the files along to another folder — see `LOCAL_DB_SWITCH` for the other one. */
  LOCAL_DB_SET_DIR: 'local-db:set-dir',
  /** Every base the user has opened, with what is in it. */
  LOCAL_DB_LIST: 'local-db:list',
  /** Read another base, leaving both where they are. */
  LOCAL_DB_SWITCH: 'local-db:switch',
  /** Drop a base from the list. */
  LOCAL_DB_FORGET: 'local-db:forget',
  /** Show a remembered base in the file manager. */
  LOCAL_DB_REVEAL: 'local-db:reveal',

  PROFILE_LABELS_GET: 'profile:labels-get',
  PROFILE_LABELS_REFRESH: 'profile:labels-refresh',
  PROFILE_SET_CURRENCY: 'profile:set-currency',
  PROFILE_LABEL_CREATE: 'profile:label-create',
  PROFILE_LABEL_UPDATE: 'profile:label-update',
  PROFILE_LABEL_DELETE: 'profile:label-delete',
  PROFILE_LABEL_REORDER: 'profile:label-reorder',

  MAIL_GET_LETTERS: 'mail:get-letters',
  MAIL_OPEN_REQUEST: 'mail:open-request',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',
  SETTINGS_PICK_FILE: 'settings:pick-file',

  STEAM_CLEAR_SESSION: 'steam:clear-session',
  STEAM_CHECK: 'steam:check',
  STEAM_CHECKS: 'steam:checks',
  STEAM_FRIENDS: 'steam:friends',
  /** The mass authenticator link. */
  STEAM_LINK: 'steam:link',

  STEAM_GUARD_STATUS: 'steam-guard:status',
  STEAM_GUARD_LINK: 'steam-guard:link',
  STEAM_GUARD_UNLINK: 'steam-guard:unlink',
  STEAM_GUARD_CODE: 'steam-guard:code',
  STEAM_GUARD_SESSION_INFO: 'steam-guard:session-info',
  STEAM_GUARD_APPROVE: 'steam-guard:approve',
  STEAM_GUARD_SCREENS: 'steam-guard:screens',
  STEAM_GUARD_CONFIRMATIONS: 'steam-guard:confirmations',
  STEAM_GUARD_CONFIRMATIONS_ACT: 'steam-guard:confirmations-act',

  TELEGRAM_CONVERT_PICK_DIR: 'telegram:convert-pick-dir',
  TELEGRAM_CONVERT_SCAN: 'telegram:convert-scan',
  TELEGRAM_CONVERT_RUN: 'telegram:convert-run',
  TELEGRAM_PICK_PATH: 'telegram:pick-path',
  TELEGRAM_IDENTIFY: 'telegram:identify',
  TELEGRAM_CHECK: 'telegram:check',
  TELEGRAM_PROFILE_FILL: 'telegram:profile-fill',
  TELEGRAM_CLEANUP: 'telegram:cleanup',
  TELEGRAM_PRIVACY: 'telegram:privacy',
  TELEGRAM_AVATAR_PACK: 'telegram:avatar-pack',
  TELEGRAM_PROFILES: 'telegram:profiles',
  TELEGRAM_AVATAR: 'telegram:avatar',

  /** The mass-operations queue, named after nothing in particular on purpose. */
  TASK_CANCEL: 'task:cancel',
  TASK_PROGRESS: 'task:progress',

  PROXY_TEST: 'proxy:test',
  PROXY_FETCH_MARKET: 'proxy:fetch-market',
  BROWSER_NAV_BACK: 'browser-nav:back',
  BROWSER_NAV_FORWARD: 'browser-nav:forward',
  BROWSER_NAV_RELOAD: 'browser-nav:reload',
  BROWSER_NAV_STOP: 'browser-nav:stop',
  BROWSER_NAV_GO: 'browser-nav:go',
  BROWSER_NAV_COPY_URL: 'browser-nav:copy-url',
  BROWSER_NAV_OPEN_EXTERNAL: 'browser-nav:open-external',
  BROWSER_NAV_EXPAND: 'browser-nav:expand',
  BROWSER_NAV_COLLAPSE: 'browser-nav:collapse',
  BROWSER_NAV_PROXY_RETEST: 'browser-nav:proxy-retest',
  BROWSER_NAV_OPEN_EMAIL: 'browser-nav:open-email',
  BROWSER_NAV_STATE: 'browser-nav:state',

  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_PING_API: 'app:ping-api',
  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_LOGS: 'app:open-logs',
  APP_EXPORT_LOG: 'app:export-log',

  ACTION_LOG_LIST: 'action-log:list',
  ACTION_LOG_RECORD: 'action-log:record',
  ACTION_LOG_CLEAR: 'action-log:clear',
  ACTION_LOG_EXPORT: 'action-log:export',
  ACTION_LOG_ENTRY: 'action-log:entry',

  NOTIFY_SHOW: 'notify:show',

  METRICS_STATE: 'metrics:state',
  METRICS_SET_ENABLED: 'metrics:set-enabled',
  METRICS_RESET_ID: 'metrics:reset-id',
  METRICS_PREVIEW: 'metrics:preview',

  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATUS: 'update:status',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface IpcRequestMap {
  [IPC_CHANNELS.AUTH_OPEN_IN_APP]: undefined;
  [IPC_CHANNELS.AUTH_OPEN_BROWSER]: undefined;
  [IPC_CHANNELS.AUTH_LOGOUT]: undefined;
  [IPC_CHANNELS.AUTH_GET_STATUS]: undefined;
  [IPC_CHANNELS.AUTH_SUBMIT_TOKEN]: { token: string };
  [IPC_CHANNELS.ACCOUNTS_LIST]: undefined;
  [IPC_CHANNELS.ACCOUNTS_LIST_STREAM]:
    | { only?: ServiceId; scope?: MarketScope; streamId?: number }
    | undefined;
  [IPC_CHANNELS.ACCOUNTS_REFRESH]: undefined;
  [IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE]: undefined;
  [IPC_CHANNELS.ACCOUNTS_GET_PREVIEW]: { itemId: number };
  [IPC_CHANNELS.ACCOUNTS_GET_MAIL]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_LOGIN]: {
    itemId: number;
    method: 'native' | 'web';
    proxyId?: string | null;
    proxyTest?: ProxyTestInfo | null;
  };
  [IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_CHECK]: { itemId: number };
  [IPC_CHANNELS.ACCOUNT_ADD_TAG]: { itemId: number; tagId: number };
  [IPC_CHANNELS.ACCOUNT_REMOVE_TAG]: { itemId: number; tagId: number };
  // `''` is a legitimate value: it means «убрать заметку».
  [IPC_CHANNELS.ACCOUNT_SET_NOTE]: { itemId: number; text: string };
  [IPC_CHANNELS.LOCAL_ACCOUNT_CREATE]: { input: LocalAccountInput };
  [IPC_CHANNELS.LOCAL_ACCOUNT_UPDATE]: { id: number; input: LocalAccountInput };
  [IPC_CHANNELS.LOCAL_ACCOUNT_DELETE]: { id: number };
  [IPC_CHANNELS.LOCAL_ACCOUNT_FORM]: { id: number };
  [IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_PREVIEW]: LocalImportRequest;
  [IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_COMMIT]: LocalImportCommitRequest;
  /** Show an account's folder in the file manager. */
  [IPC_CHANNELS.LOCAL_ACCOUNT_REVEAL]: { id: number; service: LocalServiceId | null };
  [IPC_CHANNELS.LOCAL_ACCOUNT_MOVE]: { id: number; group: string };
  [IPC_CHANNELS.LOCAL_ACCOUNT_GROUPS]: undefined;
  [IPC_CHANNELS.LOCAL_ACCOUNT_LABELS]: { id: number; labels: number[] };
  [IPC_CHANNELS.LOCAL_LABEL_LIST]: undefined;
  [IPC_CHANNELS.LOCAL_LABEL_SAVE]: { id: number | null; title: string; bc: string };
  [IPC_CHANNELS.LOCAL_LABEL_DELETE]: { id: number };
  [IPC_CHANNELS.LOCAL_DB_PICK_DIR]: undefined;
  [IPC_CHANNELS.LOCAL_DB_SET_DIR]: { dir: string | null; mode: LocalDbMoveMode };
  [IPC_CHANNELS.LOCAL_DB_LIST]: undefined;
  [IPC_CHANNELS.LOCAL_DB_SWITCH]: { dir: string | null };
  [IPC_CHANNELS.LOCAL_DB_FORGET]: { dir: string };
  [IPC_CHANNELS.LOCAL_DB_REVEAL]: { dir: string | null };
  [IPC_CHANNELS.PROFILE_LABELS_GET]: undefined;
  [IPC_CHANNELS.PROFILE_LABELS_REFRESH]: undefined;
  [IPC_CHANNELS.PROFILE_SET_CURRENCY]: { currency: MarketCurrency };
  [IPC_CHANNELS.PROFILE_LABEL_CREATE]: { title: string; bc: string };
  [IPC_CHANNELS.PROFILE_LABEL_UPDATE]: { tagId: number; title: string; bc: string };
  [IPC_CHANNELS.PROFILE_LABEL_DELETE]: { tagId: number };
  [IPC_CHANNELS.PROFILE_LABEL_REORDER]: { tagIds: number[] };
  [IPC_CHANNELS.MAIL_GET_LETTERS]: MailLettersRequest;
  [IPC_CHANNELS.SETTINGS_GET]: undefined;
  [IPC_CHANNELS.SETTINGS_SET]: Partial<LauncherSettings>;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: PickFileOptions;
  [IPC_CHANNELS.STEAM_CLEAR_SESSION]: undefined;
  [IPC_CHANNELS.STEAM_CHECK]: SteamCheckRequest;
  [IPC_CHANNELS.STEAM_CHECKS]: undefined;
  [IPC_CHANNELS.STEAM_FRIENDS]: SteamFriendsRequest;
  [IPC_CHANNELS.STEAM_LINK]: SteamLinkRequest;
  [IPC_CHANNELS.STEAM_GUARD_STATUS]: { accountId: number };
  [IPC_CHANNELS.STEAM_GUARD_LINK]: {
    accountId: number;
    proxyId?: string | null;
    emailCode?: string;
  };
  [IPC_CHANNELS.STEAM_GUARD_UNLINK]: { accountId: number };
  [IPC_CHANNELS.STEAM_GUARD_CODE]: { accountId: number };
  [IPC_CHANNELS.STEAM_GUARD_SESSION_INFO]: { accountId: number; url: string };
  [IPC_CHANNELS.STEAM_GUARD_APPROVE]: { accountId: number; url: string; approve: boolean };
  [IPC_CHANNELS.STEAM_GUARD_SCREENS]: undefined;
  [IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS]: { accountId: number };
  [IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS_ACT]: {
    accountId: number;
    action: GuardConfirmationAction;
    /** Whole objects, not ids: Steam needs each item's nonce alongside its id. */
    items: GuardConfirmation[];
  };
  [IPC_CHANNELS.TELEGRAM_CONVERT_PICK_DIR]: { title?: string };
  [IPC_CHANNELS.TELEGRAM_CONVERT_SCAN]: { dir: string };
  [IPC_CHANNELS.TELEGRAM_CONVERT_RUN]: {
    dir: string;
    ids: string[];
    target: TelegramConvertTarget;
    outDir: string;
    withJson: boolean;
  };
  /** Windows cannot offer files and folders in one dialog, hence the mode. */
  [IPC_CHANNELS.TELEGRAM_PICK_PATH]: { title?: string; mode: 'file' | 'dir' };
  [IPC_CHANNELS.TELEGRAM_IDENTIFY]: { text?: string; path?: string };
  [IPC_CHANNELS.TELEGRAM_CHECK]: TelegramCheckRequest;
  [IPC_CHANNELS.TELEGRAM_PROFILE_FILL]: TelegramProfileRequest;
  [IPC_CHANNELS.TELEGRAM_CLEANUP]: TelegramCleanupRequest;
  [IPC_CHANNELS.TELEGRAM_PRIVACY]: TelegramPrivacyRequest;
  [IPC_CHANNELS.TELEGRAM_AVATAR_PACK]: { dir: string };
  [IPC_CHANNELS.TELEGRAM_PROFILES]: undefined;
  [IPC_CHANNELS.TELEGRAM_AVATAR]: { accountId: number };
  [IPC_CHANNELS.TASK_CANCEL]: { runId: string };
  [IPC_CHANNELS.PROXY_TEST]: Pick<
    ProxyEntry,
    'host' | 'port' | 'username' | 'password' | 'protocol'
  >;
  [IPC_CHANNELS.PROXY_FETCH_MARKET]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_BACK]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_FORWARD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_RELOAD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_STOP]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_GO]: string;
  [IPC_CHANNELS.BROWSER_NAV_COPY_URL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_EXPAND]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_COLLAPSE]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EMAIL]: undefined;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: { url: string };
  [IPC_CHANNELS.APP_PING_API]: undefined;
  [IPC_CHANNELS.APP_GET_VERSION]: undefined;
  [IPC_CHANNELS.APP_OPEN_LOGS]: undefined;
  [IPC_CHANNELS.APP_EXPORT_LOG]: undefined;
  [IPC_CHANNELS.ACTION_LOG_LIST]: undefined;
  /** An action the renderer performed as one piece of work. */
  [IPC_CHANNELS.ACTION_LOG_RECORD]: ActionDraft;
  [IPC_CHANNELS.ACTION_LOG_CLEAR]: undefined;
  [IPC_CHANNELS.ACTION_LOG_EXPORT]: undefined;

  [IPC_CHANNELS.NOTIFY_SHOW]: DesktopNotification;

  [IPC_CHANNELS.METRICS_STATE]: undefined;
  /** The answer to the consent question — `false` is an answer, not an absence. */
  [IPC_CHANNELS.METRICS_SET_ENABLED]: boolean;
  [IPC_CHANNELS.METRICS_RESET_ID]: undefined;
  [IPC_CHANNELS.METRICS_PREVIEW]: undefined;

  [IPC_CHANNELS.UPDATE_CHECK]: undefined;
  [IPC_CHANNELS.UPDATE_DOWNLOAD]: undefined;
  [IPC_CHANNELS.UPDATE_INSTALL]: undefined;
}

export interface IpcResponseMap {
  [IPC_CHANNELS.AUTH_OPEN_IN_APP]: undefined;
  [IPC_CHANNELS.AUTH_OPEN_BROWSER]: { state: string };
  [IPC_CHANNELS.AUTH_LOGOUT]: undefined;
  [IPC_CHANNELS.AUTH_GET_STATUS]: AuthStatus;
  [IPC_CHANNELS.AUTH_SUBMIT_TOKEN]: AuthTokenSubmitResult;
  [IPC_CHANNELS.ACCOUNTS_LIST]: AccountSummary[];
  [IPC_CHANNELS.ACCOUNTS_LIST_STREAM]: undefined;
  [IPC_CHANNELS.ACCOUNTS_REFRESH]: AccountSummary[];
  [IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE]: undefined;
  [IPC_CHANNELS.ACCOUNTS_GET_PREVIEW]: AccountPreview | null;
  // Deliberately not `AccountDetails`.
  [IPC_CHANNELS.ACCOUNTS_GET_MAIL]: MailCredentials | null;
  // `cancelled` marks the one failure that is not one: the user aborted the attempt.
  [IPC_CHANNELS.ACCOUNT_LOGIN]: { ok: boolean; message?: string; cancelled?: boolean };
  [IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL]: undefined;
  [IPC_CHANNELS.ACCOUNT_CHECK]: CheckAccountResult;
  [IPC_CHANNELS.ACCOUNT_ADD_TAG]: TagOpResult;
  [IPC_CHANNELS.ACCOUNT_REMOVE_TAG]: TagOpResult;
  [IPC_CHANNELS.ACCOUNT_SET_NOTE]: NoteOpResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_CREATE]: LocalAccountResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_UPDATE]: LocalAccountResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_DELETE]: LocalAccountResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_FORM]: LocalAccountEdit | null;
  [IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_PREVIEW]: LocalImportPreviewResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_COMMIT]: LocalImportCommitResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_REVEAL]: RevealFolderResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_MOVE]: LocalAccountResult;
  [IPC_CHANNELS.LOCAL_ACCOUNT_GROUPS]: Record<LocalServiceId, string[]>;
  [IPC_CHANNELS.LOCAL_ACCOUNT_LABELS]: LocalAccountResult;
  [IPC_CHANNELS.LOCAL_LABEL_LIST]: LocalLabel[];
  [IPC_CHANNELS.LOCAL_LABEL_SAVE]: LocalLabelResult;
  [IPC_CHANNELS.LOCAL_LABEL_DELETE]: LocalLabelResult;
  [IPC_CHANNELS.LOCAL_DB_PICK_DIR]: string | null;
  [IPC_CHANNELS.LOCAL_DB_SET_DIR]: LocalDbSetDirResult;
  [IPC_CHANNELS.LOCAL_DB_LIST]: LocalDbEntry[];
  [IPC_CHANNELS.LOCAL_DB_SWITCH]: LocalDbSwitchResult;
  [IPC_CHANNELS.LOCAL_DB_FORGET]: LocalDbEntry[];
  [IPC_CHANNELS.LOCAL_DB_REVEAL]: RevealFolderResult;
  [IPC_CHANNELS.PROFILE_LABELS_GET]: UserLabel[];
  [IPC_CHANNELS.PROFILE_LABELS_REFRESH]: UserLabel[];
  [IPC_CHANNELS.PROFILE_SET_CURRENCY]: { ok: boolean; message?: string };
  [IPC_CHANNELS.PROFILE_LABEL_CREATE]: LabelMutationResult;
  [IPC_CHANNELS.PROFILE_LABEL_UPDATE]: LabelMutationResult;
  [IPC_CHANNELS.PROFILE_LABEL_DELETE]: LabelMutationResult;
  [IPC_CHANNELS.PROFILE_LABEL_REORDER]: LabelMutationResult;
  [IPC_CHANNELS.MAIL_GET_LETTERS]: MailLettersResult;
  [IPC_CHANNELS.SETTINGS_GET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_SET]: SettingsResponse;
  [IPC_CHANNELS.SETTINGS_PICK_FILE]: string | null;
  [IPC_CHANNELS.STEAM_CLEAR_SESSION]: { ok: boolean; message?: string };
  /** The same start-or-refuse answer a Telegram run gives — one queue, one reply. */
  [IPC_CHANNELS.STEAM_CHECK]: TelegramRunStart;
  /** What the last run wrote down, one record per account that has been checked. */
  [IPC_CHANNELS.STEAM_CHECKS]: SteamCheckRecord[];
  /** Same again: the purge outlives an `invoke`, so this only says it started. */
  [IPC_CHANNELS.STEAM_FRIENDS]: TelegramRunStart;
  /** And again: the linking happens in the queue, this only says it began. */
  [IPC_CHANNELS.STEAM_LINK]: TelegramRunStart;
  [IPC_CHANNELS.STEAM_GUARD_STATUS]: GuardStatus;
  [IPC_CHANNELS.STEAM_GUARD_LINK]: GuardResult<{ status: GuardStatus }>;
  [IPC_CHANNELS.STEAM_GUARD_UNLINK]: { ok: boolean };
  [IPC_CHANNELS.STEAM_GUARD_CODE]: GuardResult<{ code: GuardCodeResult }>;
  [IPC_CHANNELS.STEAM_GUARD_SESSION_INFO]: GuardResult<{ info: GuardAuthSessionInfo }>;
  [IPC_CHANNELS.STEAM_GUARD_APPROVE]: GuardResult<{ approved: boolean }>;
  [IPC_CHANNELS.STEAM_GUARD_SCREENS]: ScreenCapture[];
  [IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS]: GuardResult<{ confirmations: GuardConfirmation[] }>;
  [IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS_ACT]: GuardResult<{ acted: number }>;
  [IPC_CHANNELS.TELEGRAM_CONVERT_PICK_DIR]: { dir: string | null };
  [IPC_CHANNELS.TELEGRAM_CONVERT_SCAN]: TelegramConvertScan;
  [IPC_CHANNELS.TELEGRAM_CONVERT_RUN]: TelegramConvertRunResult;
  [IPC_CHANNELS.TELEGRAM_PICK_PATH]: { path: string | null };
  [IPC_CHANNELS.TELEGRAM_IDENTIFY]: TelegramIdentifyResult;
  [IPC_CHANNELS.TELEGRAM_CHECK]: TelegramRunStart;
  [IPC_CHANNELS.TELEGRAM_PROFILE_FILL]: TelegramRunStart;
  [IPC_CHANNELS.TELEGRAM_CLEANUP]: TelegramRunStart;
  [IPC_CHANNELS.TELEGRAM_PRIVACY]: TelegramRunStart;
  [IPC_CHANNELS.TELEGRAM_AVATAR_PACK]: TelegramAvatarPack;
  [IPC_CHANNELS.TELEGRAM_PROFILES]: TelegramProfile[];
  /** `data:image/jpeg;base64,…`, or `null` when the account has no picture. */
  [IPC_CHANNELS.TELEGRAM_AVATAR]: string | null;
  [IPC_CHANNELS.TASK_CANCEL]: undefined;
  [IPC_CHANNELS.PROXY_TEST]: ProxyTestResult;
  [IPC_CHANNELS.PROXY_FETCH_MARKET]: {
    ok: boolean;
    proxies?: Array<Pick<ProxyEntry, 'protocol' | 'host' | 'port' | 'username' | 'password'>>;
    message?: string;
  };
  [IPC_CHANNELS.BROWSER_NAV_BACK]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_FORWARD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_RELOAD]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_STOP]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_GO]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_COPY_URL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EXTERNAL]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_EXPAND]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_COLLAPSE]: undefined;
  [IPC_CHANNELS.BROWSER_NAV_PROXY_RETEST]: ProxyTestResult;
  [IPC_CHANNELS.BROWSER_NAV_OPEN_EMAIL]: undefined;
  [IPC_CHANNELS.APP_OPEN_EXTERNAL]: undefined;
  [IPC_CHANNELS.APP_PING_API]: NetworkStatus;
  [IPC_CHANNELS.APP_GET_VERSION]: string;
  [IPC_CHANNELS.APP_OPEN_LOGS]: undefined;
  [IPC_CHANNELS.APP_EXPORT_LOG]: { ok: boolean; path?: string };
  /** Newest first — the viewer reads top-down and never sorts. */
  [IPC_CHANNELS.ACTION_LOG_LIST]: ActionEntry[];
  [IPC_CHANNELS.ACTION_LOG_RECORD]: undefined;
  [IPC_CHANNELS.ACTION_LOG_CLEAR]: undefined;
  [IPC_CHANNELS.ACTION_LOG_EXPORT]: { ok: boolean; path?: string };
  [IPC_CHANNELS.NOTIFY_SHOW]: undefined;

  [IPC_CHANNELS.METRICS_STATE]: MetricsState;
  [IPC_CHANNELS.METRICS_SET_ENABLED]: MetricsState;
  [IPC_CHANNELS.METRICS_RESET_ID]: MetricsState;
  /** The next request's body verbatim, pretty-printed — «показать, что отправляется». */
  [IPC_CHANNELS.METRICS_PREVIEW]: string;

  [IPC_CHANNELS.UPDATE_CHECK]: undefined;
  [IPC_CHANNELS.UPDATE_DOWNLOAD]: undefined;
  [IPC_CHANNELS.UPDATE_INSTALL]: undefined;
}

export interface IpcEventMap {
  [IPC_CHANNELS.AUTH_TOKEN_RECEIVED]: AuthTokenPayload;
  [IPC_CHANNELS.AUTH_STATUS_CHANGED]: AuthStatus;
  /** One finished action, pushed as it lands, so an open viewer stays live. */
  [IPC_CHANNELS.ACTION_LOG_ENTRY]: ActionEntry;
  [IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS]: LoginProgress;
  [IPC_CHANNELS.ACCOUNT_LOGIN_REQUEST]: { itemId: number };
  [IPC_CHANNELS.ACCOUNTS_CATEGORY]: AccountsCategoryEvent;
  [IPC_CHANNELS.SETTINGS_CHANGED]: SettingsResponse;
  [IPC_CHANNELS.UPDATE_STATUS]: UpdateStatus;
  [IPC_CHANNELS.BROWSER_NAV_STATE]: BrowserNavState;
  [IPC_CHANNELS.MAIL_OPEN_REQUEST]: { emailPassword: string };
  [IPC_CHANNELS.TASK_PROGRESS]: TelegramTaskEvent;
}

export type { AuthTokenPayload };

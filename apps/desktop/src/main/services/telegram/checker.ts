import { tl } from '@mtcute/core';
import type { Message } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type {
  TelegramCheckInfo,
  TelegramCheckStatus,
  TelegramSpamVerdict,
  TelegramTaskStep,
} from '@shared-types';
import log from 'electron-log/main';
import { sleep } from '../../lib/sleep';
import { countryFromPhone } from './geo';
import { type SpamKeyboard, readSpamAnswer } from './spam';

/** Answers that mean the key is gone rather than the request having failed. */
const DEAD: readonly string[] = [
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_DUPLICATED',
  'AUTH_KEY_PERM_EMPTY',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
];

/** `NOT_FOUND` sits apart from the list above, and only ever answers `getMe`. */
const DEAD_IDENTITY: readonly string[] = [...DEAD, 'NOT_FOUND'];

/** mtcute's own `RpcError.is` reaches straight for `err.constructor`. */
const asRpcError = (err: unknown): tl.RpcError | null =>
  err !== null && err !== undefined && tl.RpcError.is(err) ? err : null;

/** The code Telegram refused with, or `null` when the failure was not an RPC one at all. */
export const rpcErrorText = (err: unknown): string | null => asRpcError(err)?.text ?? null;

/** A key that will never work again, whatever the request was. */
export const isDeadKeyError = (err: unknown): string | null => {
  const rpc = asRpcError(err);
  if (!rpc) return null;
  return DEAD.includes(rpc.text) ? rpc.text : null;
};

/** The same reading, plus `NOT_FOUND`. */
export const isDeadIdentityError = (err: unknown): string | null => {
  const rpc = asRpcError(err);
  if (!rpc) return null;
  return DEAD_IDENTITY.includes(rpc.text) ? rpc.text : null;
};

/** Answers that mean "ask again", not "here is your answer". */
const RETRYABLE: readonly string[] = [
  'TIMEDOUT',
  'TIMEOUT',
  'RPC_SEND_FAIL',
  'RPC_CALL_FAIL',
  'RPC_MCGET_FAIL',
  'MSGID_DECREASE_RETRY',
];

export const isRetryableError = (err: unknown): boolean => {
  const rpc = asRpcError(err);
  return rpc !== null && RETRYABLE.includes(rpc.text);
};

/** The connection is gone, and no amount of asking will change that. */
const CLIENT_GONE = [
  'client is destroyed',
  'session is reset',
  'connection destroyed',
  'not connected to any dc',
];

export const isClientGoneError = (err: unknown): boolean => {
  if (asRpcError(err)) return false;
  const message = err instanceof Error ? err.message.toLowerCase() : '';
  return CLIENT_GONE.some((text) => message.includes(text));
};

/** The one retryable answer that must not be retried immediately. */
export const isRateLimitError = (err: unknown): boolean =>
  asRpcError(err)?.text === 'RATE_LIMIT_EXCEEDED';

/** What to wait out an unnumbered rate limit for before the one retry. */
export const RATE_LIMIT_PAUSE_MS = 5_000;

/** `FLOOD_WAIT_X` and its siblings, in seconds. */
export const floodWaitSeconds = (err: unknown): number | null => {
  const rpc = asRpcError(err);
  if (!rpc) return null;
  if (rpc.is('FLOOD_WAIT_%d')) return rpc.seconds;
  if (rpc.is('SLOWMODE_WAIT_%d')) return rpc.seconds;
  if (rpc.is('FLOOD_TEST_PHONE_WAIT_%d')) return rpc.seconds;
  return null;
};

/** Telegram's newer way of taking an account away without taking it away. */
const FREEZE_KEY = 'freeze_since_date';
const FROZEN_ERROR = 'FROZEN_METHOD_INVALID';

export const isFrozenError = (err: unknown): string | null =>
  asRpcError(err)?.text === FROZEN_ERROR ? FROZEN_ERROR : null;

/** `help.getAppConfig` answers with a `jsonObject`. */
export const isFrozenAppConfig = (res: unknown): boolean => {
  const config = (res as { config?: unknown } | null | undefined)?.config;
  const entries = (config as { value?: unknown } | null | undefined)?.value;
  if (!Array.isArray(entries)) return false;

  for (const entry of entries as readonly unknown[]) {
    const pair = entry as { key?: unknown; value?: unknown } | null | undefined;
    if (pair?.key !== FREEZE_KEY) continue;
    // Same emptiness rule the market applies: the key is present on every account and carries a null or a zero until a freeze.
    const value = (pair.value as { value?: unknown } | null | undefined)?.value;
    return value !== undefined && value !== null && value !== '' && value !== 0 && value !== false;
  }
  return false;
};

/** Asks the account whether it has been frozen, and never fails doing it. */
export const readFreezeState = async (client: TelegramClient): Promise<string | null> => {
  try {
    const res = await client.call({ _: 'help.getAppConfig', hash: 0 });
    return isFrozenAppConfig(res) ? FREEZE_KEY : null;
  } catch (err) {
    // The refusal is itself the answer when it is this one.
    const frozen = isFrozenError(err);
    if (frozen) return frozen;
    log.warn('[telegram/check] app config failed', err);
    return null;
  }
};

const SPAM_BOT = 'SpamBot';

/** How long to wait for the bot to answer, and how often to look. */
const SPAM_TIMEOUT_MS = 12_000;
const SPAM_POLL_MS = 1_500;

type Peer = Awaited<ReturnType<TelegramClient['resolvePeer']>>;

/** Opens the probe, and gets past a block the previous owner left behind. */
const startSpamDialog = async (
  client: TelegramClient,
  peer: Peer,
): Promise<Awaited<ReturnType<TelegramClient['sendText']>>> => {
  try {
    return await client.sendText(peer, '/start');
  } catch (err) {
    if (asRpcError(err)?.text !== 'YOU_BLOCKED_USER') throw err;
    await client.unblockUser(peer);
    return await client.sendText(peer, '/start');
  }
};

/** Takes the probe back off the account once its answer has been read. */
const forgetSpamDialog = async (client: TelegramClient, peer: Peer): Promise<void> => {
  try {
    // `delete` rather than `clear`: the dialog itself has to go.
    await client.deleteHistory(peer, { mode: 'delete' });
  } catch (err) {
    log.warn('[telegram/check] spam dialog cleanup failed', err);
  }
};

/** The bot's keyboard, in the shape `spam.ts` reads. */
const spamKeyboard = (msg: Message): SpamKeyboard | null => {
  const markup = msg.markup;
  // Not `markup.type`: the union still carries the raw `tl.TypeReplyMarkup`, which has `_` instead.
  if (!markup || !('type' in markup)) return null;
  if (markup.type === 'reply_hide') return { kind: 'hidden' };
  if (markup.type !== 'reply') return null;
  return {
    kind: 'keys',
    // Every button variant the bot could send carries a label; the guard is for the handful of TL members that do not.
    rows: markup.buttons.map((row) => row.map((btn) => ('text' in btn ? btn.text : ''))),
  };
};

/** Sends `/start` to @SpamBot and reads the reply back out of the history. */
export const probeSpamBot = async (client: TelegramClient): Promise<TelegramSpamVerdict | null> => {
  const peer = await client.resolvePeer(SPAM_BOT);

  // The send is inside the guarded section, not before it.
  try {
    const sent = await startSpamDialog(client, peer);

    const deadline = Date.now() + SPAM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(SPAM_POLL_MS);
      const history = await client.getHistory(peer, { limit: 5 });
      // Only messages that arrived after ours: the bot's answer to a previous check is still sitting in the same dialog.
      const reply = history.find(
        (m) => !m.isOutgoing && m.id > sent.id && m.text.trim().length > 0,
      );
      if (reply) return readSpamAnswer(reply.text, spamKeyboard(reply));
    }
    // The bot never answered inside the window.
    return null;
  } finally {
    // In `finally` on purpose: a flood wait halfway through the polling still leaves our `/start` on the account.
    await forgetSpamDialog(client, peer);
  }
};

const countSessions = async (client: TelegramClient): Promise<number | null> => {
  try {
    const res = await client.call({ _: 'account.getAuthorizations' });
    return res.authorizations.length;
  } catch (err) {
    log.warn('[telegram/check] authorizations failed', err);
    return null;
  }
};

export interface CheckOptions {
  readonly withSpam: boolean;
  readonly withSessions: boolean;
  /** Fetch the 160×160 profile picture. */
  readonly withAvatar: boolean;
}

/** The check, plus the bytes that do not belong in an IPC message. */
export interface TelegramCheckResult {
  readonly info: TelegramCheckInfo;
  readonly avatar: Uint8Array | null | undefined;
}

/** The row an account gets when the only thing Telegram told us was a refusal — there is no `getMe` behind it. */
const blankCheckInfo = (status: TelegramCheckStatus, detail: string): TelegramCheckInfo => ({
  status,
  userId: null,
  phone: null,
  username: null,
  name: '',
  premium: false,
  country: null,
  spam: null,
  sessions: null,
  detail,
});

/** The row an account gets when Telegram says it no longer knows the key. */
export const deadCheckInfo = (detail: string): TelegramCheckInfo => blankCheckInfo('dead', detail);

/** The same, for a freeze that surfaced before we could learn anything else. */
export const frozenCheckInfo = (detail: string): TelegramCheckInfo =>
  blankCheckInfo('frozen', detail);

/** The small size is 160×160 and about ten kilobytes — an avatar, not a wallpaper. */
export const downloadAvatar = async (
  client: TelegramClient,
  me: Awaited<ReturnType<TelegramClient['getMe']>>,
): Promise<Uint8Array | null> => {
  if (!me.photo) return null;
  try {
    return await client.downloadAsBuffer(me.photo.small);
  } catch (err) {
    // A missing picture must not cost the account its liveness answer.
    log.warn('[telegram/check] avatar download failed', err);
    return null;
  }
};

/** The facts one `getMe` gives up, in the shape the row and the profile store both want. */
export const checkInfoFromUser = (
  me: Awaited<ReturnType<TelegramClient['getMe']>>,
  extra: {
    spam?: TelegramSpamVerdict | null;
    sessions?: number | null;
    frozen?: string | null;
  } = {},
): TelegramCheckInfo => ({
  status: extra.frozen ? 'frozen' : 'alive',
  userId: me.id,
  phone: me.phoneNumber,
  username: me.username,
  name: me.displayName,
  premium: me.isPremium,
  country: countryFromPhone(me.phoneNumber),
  spam: extra.spam ?? null,
  sessions: extra.sessions ?? null,
  detail: extra.frozen ?? null,
});

/** The whole check for one account, on an already-connected client. */
export const checkTelegramAccount = async (
  client: TelegramClient,
  options: CheckOptions,
  report: (step: TelegramTaskStep) => void,
): Promise<TelegramCheckResult> => {
  report('me');
  let me: Awaited<ReturnType<TelegramClient['getMe']>>;
  try {
    me = await client.getMe();
  } catch (err) {
    const reason = isDeadIdentityError(err);
    if (reason) return { info: deadCheckInfo(reason), avatar: undefined };
    const frozen = isFrozenError(err);
    if (frozen) return { info: frozenCheckInfo(frozen), avatar: undefined };
    throw err;
  }

  // Always, and still under the `me` step: it is one silent request.
  let frozen = await readFreezeState(client);

  let spam: TelegramSpamVerdict | null = null;
  // A frozen account cannot send the `/start` the probe is built.
  if (options.withSpam && !frozen) {
    report('spam');
    try {
      spam = await probeSpamBot(client);
    } catch (err) {
      // A flood wait here must not lose the liveness answer we already have.
      frozen ??= isFrozenError(err);
      if (floodWaitSeconds(err) === null) log.warn('[telegram/check] spam probe failed', err);
      // Left as "did not learn", never as `unknown`.
      spam = null;
    }
  }

  let sessions: number | null = null;
  if (options.withSessions) {
    report('sessions');
    sessions = await countSessions(client);
  }

  let avatar: Uint8Array | null | undefined;
  if (options.withAvatar) {
    report('avatar');
    avatar = await downloadAvatar(client, me);
  }

  return {
    info: checkInfoFromUser(me, { spam, sessions, frozen }),
    avatar,
  };
};

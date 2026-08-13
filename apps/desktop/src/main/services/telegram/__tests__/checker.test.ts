import { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  checkTelegramAccount,
  floodWaitSeconds,
  isClientGoneError,
  isDeadIdentityError,
  isDeadKeyError,
  isFrozenAppConfig,
  isRateLimitError,
  isRetryableError,
  probeSpamBot,
} = await import('../checker');

const rpc = (text: string): tl.RpcError => new tl.RpcError(400, text);

/** The same error as it arrives from the wire. */
const wireRpc = (message: string): tl.RpcError =>
  tl.RpcError.fromTl({ _: 'rpc_error', errorCode: 420, errorMessage: message });

const ME = {
  id: 777,
  phoneNumber: '79991234567',
  username: 'seller',
  displayName: 'Иван',
  isPremium: false,
  photo: null,
};

/** The `jsonObject` shape `help.getAppConfig` really answers with. */
const appConfig = (entries: Record<string, unknown>) => ({
  _: 'help.appConfig',
  hash: 0,
  config: {
    _: 'jsonObject',
    value: Object.entries(entries).map(([key, value]) => ({ _: 'jsonObjectValue', key, value })),
  },
});

const jsonString = (value: string) => ({ _: 'jsonString', value });
const jsonNumber = (value: number) => ({ _: 'jsonNumber', value });

const READ_ONLY = { withSpam: false, withSessions: false, withAvatar: false };

const clientWith = (over: Record<string, unknown> = {}): TelegramClient =>
  ({
    getMe: vi.fn(async () => ME),
    call: vi.fn(async () => appConfig({})),
    ...over,
  }) as unknown as TelegramClient;

const check = (client: TelegramClient, options = READ_ONLY) =>
  checkTelegramAccount(client, options, () => undefined);

afterEach(() => {
  vi.useRealTimers();
});

describe('isDeadKeyError', () => {
  it('does not read NOT_FOUND as a dead key on its own', () => {
    // The market counts it, and over `getMe` it is right.
    expect(isDeadKeyError(rpc('NOT_FOUND'))).toBeNull();
    expect(isDeadIdentityError(rpc('NOT_FOUND'))).toBe('NOT_FOUND');
  });

  it('reads the authorization family as dead from either predicate', () => {
    for (const text of [
      'AUTH_KEY_UNREGISTERED',
      'AUTH_KEY_INVALID',
      'AUTH_KEY_DUPLICATED',
      'AUTH_KEY_PERM_EMPTY',
      'SESSION_REVOKED',
      'SESSION_EXPIRED',
      'USER_DEACTIVATED',
      'USER_DEACTIVATED_BAN',
    ]) {
      expect(isDeadKeyError(rpc(text))).toBe(text);
      expect(isDeadIdentityError(rpc(text))).toBe(text);
    }
  });

  it('does not read SESSION_PASSWORD_NEEDED as a dead key', () => {
    // It ends a sign-in flow we never run.
    expect(isDeadKeyError(rpc('SESSION_PASSWORD_NEEDED'))).toBeNull();
  });

  it('leaves everything else to the run', () => {
    expect(isDeadKeyError(rpc('FLOOD_WAIT_30'))).toBeNull();
    expect(isDeadKeyError(new Error('AUTH_KEY_INVALID'))).toBeNull();
  });
});

describe('isRetryableError', () => {
  it('recognises every code the market retries on straight away', () => {
    for (const text of [
      'TIMEDOUT',
      'TIMEOUT',
      'RPC_SEND_FAIL',
      'RPC_CALL_FAIL',
      'RPC_MCGET_FAIL',
      'MSGID_DECREASE_RETRY',
    ]) {
      expect(isRetryableError(rpc(text))).toBe(true);
    }
  });

  it('hands RATE_LIMIT_EXCEEDED to the predicate that waits first', () => {
    // Every code above means the request was lost, so going straight back in is right.
    expect(isRetryableError(rpc('RATE_LIMIT_EXCEEDED'))).toBe(false);
    expect(isRateLimitError(rpc('RATE_LIMIT_EXCEEDED'))).toBe(true);
    expect(isRateLimitError(rpc('TIMEOUT'))).toBe(false);
  });

  it('does not swallow answers that are about the account', () => {
    // A retry on a dead key is an infinite loop that never learns anything.
    expect(isRetryableError(rpc('AUTH_KEY_UNREGISTERED'))).toBe(false);
    expect(isRetryableError(rpc('FLOOD_WAIT_30'))).toBe(false);
    expect(isRetryableError(rpc('FROZEN_METHOD_INVALID'))).toBe(false);
    expect(isRetryableError(new Error('TIMEOUT'))).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

describe('isClientGoneError', () => {
  it('recognises the errors mtcute throws once the client is torn down', () => {
    for (const message of [
      'Client is destroyed',
      'Session is reset',
      'Connection destroyed',
      'Not connected to any DC',
    ]) {
      expect(isClientGoneError(new Error(message))).toBe(true);
    }
  });

  it('leaves anything that came back from Telegram alone', () => {
    // These are the opposite case: the connection worked, and the answer is about the account.
    expect(isClientGoneError(rpc('CHANNEL_PRIVATE'))).toBe(false);
    expect(isClientGoneError(rpc('TIMEOUT'))).toBe(false);
    expect(isClientGoneError(new Error('socket hang up'))).toBe(false);
    expect(isClientGoneError(null)).toBe(false);
    expect(isClientGoneError(undefined)).toBe(false);
  });
});

describe('floodWaitSeconds', () => {
  it('reads the duration off the error Telegram actually sends', () => {
    // The wire carries `FLOOD_WAIT_30`, but mtcute rewrites it on the way.
    expect(floodWaitSeconds(wireRpc('FLOOD_WAIT_30'))).toBe(30);
    expect(floodWaitSeconds(wireRpc('SLOWMODE_WAIT_7'))).toBe(7);
  });

  it('leaves an error that carries no wait alone', () => {
    expect(floodWaitSeconds(wireRpc('AUTH_KEY_UNREGISTERED'))).toBeNull();
    expect(floodWaitSeconds(new Error('FLOOD_WAIT_30'))).toBeNull();
    expect(floodWaitSeconds(null)).toBeNull();
  });

  it('is why the hand-built helper must never be used for a wait', () => {
    // `rpc()` skips the rewrite, so this shape never arrives from Telegram.
    expect(floodWaitSeconds(rpc('FLOOD_WAIT_30'))).toBeNull();
  });
});

describe('isFrozenAppConfig', () => {
  it('finds the freeze date two levels down', () => {
    expect(isFrozenAppConfig(appConfig({ freeze_since_date: jsonNumber(1_750_000_000) }))).toBe(
      true,
    );
    expect(isFrozenAppConfig(appConfig({ freeze_since_date: jsonString('2026-07-01') }))).toBe(
      true,
    );
  });

  it('leaves an ordinary account alone', () => {
    expect(isFrozenAppConfig(appConfig({ premium_purchase_blocked: jsonString('no') }))).toBe(
      false,
    );
    expect(isFrozenAppConfig(appConfig({}))).toBe(false);
  });

  it('treats an empty value the way the market does, as no freeze', () => {
    // The key is handed out to everyone and carries a placeholder until a freeze actually starts.
    expect(isFrozenAppConfig(appConfig({ freeze_since_date: { _: 'jsonNull' } }))).toBe(false);
    expect(isFrozenAppConfig(appConfig({ freeze_since_date: jsonNumber(0) }))).toBe(false);
    expect(isFrozenAppConfig(appConfig({ freeze_since_date: jsonString('') }))).toBe(false);
  });

  it('reads a shape it does not understand as "not frozen" instead of throwing', () => {
    // Telegram reshapes this blob at will.
    expect(isFrozenAppConfig({ _: 'help.appConfigNotModified' })).toBe(false);
    expect(isFrozenAppConfig({ config: { value: 'freeze_since_date' } })).toBe(false);
    expect(isFrozenAppConfig({ config: null })).toBe(false);
    expect(isFrozenAppConfig([{ key: 'freeze_since_date' }])).toBe(false);
    expect(isFrozenAppConfig(null)).toBe(false);
    expect(isFrozenAppConfig(42)).toBe(false);
  });
});

describe('checkTelegramAccount', () => {
  it('reports a dead key as an answer rather than a failure', async () => {
    const client = clientWith({
      getMe: vi.fn(async () => {
        throw rpc('NOT_FOUND');
      }),
    });

    const { info } = await check(client);
    expect(info).toMatchObject({ status: 'dead', detail: 'NOT_FOUND', userId: null });
  });

  it('calls an account with a freeze date frozen, not alive', async () => {
    const client = clientWith({
      call: vi.fn(async () => appConfig({ freeze_since_date: jsonNumber(1_750_000_000) })),
    });

    const { info } = await check(client);
    // The whole point of the freeze check: `getMe` answered perfectly and every fact below is real — only the verdict differs.
    expect(info.status).toBe('frozen');
    expect(info.detail).toBe('freeze_since_date');
    expect(info.userId).toBe(777);
    expect(info.name).toBe('Иван');
  });

  it('calls an account frozen when the config request is itself refused', async () => {
    const client = clientWith({
      call: vi.fn(async () => {
        throw rpc('FROZEN_METHOD_INVALID');
      }),
    });

    const { info } = await check(client);
    expect(info).toMatchObject({ status: 'frozen', detail: 'FROZEN_METHOD_INVALID' });
  });

  it('reports frozen when the freeze only shows up on the spam probe', async () => {
    const client = clientWith({
      resolvePeer: vi.fn(async () => ({ _: 'inputPeerUser' })),
      sendText: vi.fn(async () => {
        throw rpc('FROZEN_METHOD_INVALID');
      }),
    });

    const { info } = await check(client, { ...READ_ONLY, withSpam: true });
    // A refusal to write is not a failed probe.
    expect(info.status).toBe('frozen');
    expect(info.detail).toBe('FROZEN_METHOD_INVALID');
  });

  it('stays alive when the freeze check itself fails', async () => {
    const client = clientWith({
      call: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });

    const { info } = await check(client);
    // A freeze is extra news; losing the answer the user actually asked for because a second request timed out would be.
    expect(info.status).toBe('alive');
    expect(info.detail).toBeNull();
  });

  it('does not spend the spam probe on an account it already knows is frozen', async () => {
    const sendText = vi.fn(async () => ({ id: 1 }));
    const client = clientWith({
      call: vi.fn(async () => appConfig({ freeze_since_date: jsonString('2026-07-01') })),
      resolvePeer: vi.fn(async () => ({ _: 'inputPeerUser' })),
      sendText,
    });

    const { info } = await check(client, { ...READ_ONLY, withSpam: true });
    expect(info.status).toBe('frozen');
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe('probeSpamBot', () => {
  const FREE_REPLY = 'Good news, no limits are currently applied to your account.';

  const spamClient = (over: Record<string, unknown> = {}) => {
    // Typed parameters, unused: they are what lets the assertions below read back *how* the dialog was deleted.
    const deleteHistory = vi.fn(async (_peer: unknown, _params?: unknown) => undefined);
    const sendText = vi.fn(async () => ({ id: 10 }));
    const unblockUser = vi.fn(async () => undefined);
    const client = {
      resolvePeer: vi.fn(async () => ({ _: 'inputPeerUser' })),
      sendText,
      unblockUser,
      deleteHistory,
      getHistory: vi.fn(async () => [{ id: 11, isOutgoing: false, text: FREE_REPLY }]),
      ...over,
    };
    return { client: client as unknown as TelegramClient, deleteHistory, sendText, unblockUser };
  };

  /** The polling loop sleeps; nothing here should cost the suite real seconds. */
  const settle = async <T>(promise: Promise<T>): Promise<T> => {
    await vi.advanceTimersByTimeAsync(20_000);
    return promise;
  };

  it('deletes the conversation it started once the verdict is in', async () => {
    vi.useFakeTimers();
    const { client, deleteHistory } = spamClient();

    const verdict = await settle(probeSpamBot(client));

    expect(verdict).toEqual({ status: 'free', until: null });
    // The buyer must not inherit our `/start` and the limitation report under it: the dialog itself goes.
    expect(deleteHistory).toHaveBeenCalledTimes(1);
    expect(deleteHistory.mock.calls[0]?.[1]).toEqual({ mode: 'delete' });
  });

  it('cleans up even when the bot never answers, and reports no verdict at all', async () => {
    vi.useFakeTimers();
    const { client, deleteHistory } = spamClient({ getHistory: vi.fn(async () => []) });

    const verdict = await settle(probeSpamBot(client));

    // `null`, not `{status: 'unknown'}`.
    expect(verdict).toBeNull();
    expect(deleteHistory).toHaveBeenCalledTimes(1);
  });

  it('keeps the verdict when the cleanup fails', async () => {
    vi.useFakeTimers();
    const { client } = spamClient({
      deleteHistory: vi.fn(async () => {
        throw new Error('MESSAGE_DELETE_FORBIDDEN');
      }),
    });

    // Tidying is worth a log line, never the answer we came for.
    await expect(settle(probeSpamBot(client))).resolves.toEqual({ status: 'free', until: null });
  });

  it('unblocks the bot the seller blocked, and asks again', async () => {
    vi.useFakeTimers();
    let first = true;
    const sendText = vi.fn(async () => {
      if (first) {
        first = false;
        throw rpc('YOU_BLOCKED_USER');
      }
      return { id: 10 };
    });
    const { client, unblockUser } = spamClient({ sendText });

    const verdict = await settle(probeSpamBot(client));

    expect(unblockUser).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(verdict).toEqual({ status: 'free', until: null });
  });

  it('does not retry a refusal that unblocking cannot fix', async () => {
    const sendText = vi.fn(async () => {
      throw rpc('PEER_FLOOD');
    });
    const { client, unblockUser } = spamClient({ sendText });

    // No timers are involved: the send fails before the polling loop starts.
    await expect(probeSpamBot(client)).rejects.toThrow();
    expect(unblockUser).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});

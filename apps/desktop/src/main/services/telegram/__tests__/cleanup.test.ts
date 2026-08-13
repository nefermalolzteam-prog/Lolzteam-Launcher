import { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { TelegramCleanupTarget, TelegramTaskStep } from '@shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { cleanupTelegramAccount } = await import('../cleanup');
const { default: log } = await import('electron-log/main');

const ME = {
  id: 777,
  phoneNumber: '79991234567',
  username: 'seller',
  displayName: 'Иван',
  isPremium: false,
  photo: null,
};

const appConfig = (entries: Record<string, unknown> = {}) => ({
  _: 'help.appConfig',
  hash: 0,
  config: {
    _: 'jsonObject',
    value: Object.entries(entries).map(([key, value]) => ({ _: 'jsonObjectValue', key, value })),
  },
});

/** What `messages.deleteHistory` answers with. */
const affected = (offset = 0) => ({ _: 'messages.affectedHistory', pts: 0, ptsCount: 0, offset });

/** A dialog, named by what `classify` reads off it and nothing more. */
type Fake = { id: number } & (
  | { type: 'user'; isBot?: boolean; isSupport?: boolean }
  | { type: 'chat'; chatType: string }
);

const dialogs = (peers: readonly Fake[]) => ({
  // Mirrors mtcute's `iterDialogs`: an async iterable of objects carrying a peer.
  async *[Symbol.asyncIterator]() {
    for (const peer of peers) yield { peer: { isBot: false, isSupport: false, ...peer } };
  },
});

/** The four kinds that hold someone else's conversation. */
const ALL: readonly TelegramCleanupTarget[] = ['channels', 'groups', 'bots', 'private'];

const OPTIONS = { targets: ALL, includeArchived: false, revokePrivate: false };

/** A contact, reduced to what `deleteContacts` is handed and counts back. */
const person = (id: number) => ({ id }) as never;

/** A folder, reduced to the two fields the sweep reads off it. */
const folder = (id: number, kind = 'dialogFilter') => ({ _: kind, id }) as never;

const clientWith = (peers: readonly Fake[], over: Record<string, unknown> = {}) => {
  // Both fakes declare the arguments they ignore, for the same reason: a `vi.fn` that takes none is typed as taking none.
  const iterDialogs = vi.fn((_params?: unknown) => dialogs(peers));
  const leaveChat = vi.fn(async (_peer: unknown, _params?: unknown) => undefined);
  const deleteHistory = vi.fn(async (_peer: unknown, _params?: unknown) => undefined);
  // Telegram answers with the profiles it actually took off the list.
  const getContacts = vi.fn(async () => [] as unknown[]);
  const deleteContacts = vi.fn(async (users: unknown[]) => users);
  const getFolders = vi.fn(async () => ({ filters: [] as unknown[] }));
  const deleteFolder = vi.fn(async (_id: unknown) => undefined);
  // `messages.deleteHistory` goes out raw now.
  const drop = (over.deleteHistory ?? deleteHistory) as (p: unknown, o: unknown) => Promise<void>;
  const call = vi.fn(async (req: { _: string; peer?: unknown; revoke?: boolean }) => {
    if (req._ !== 'messages.deleteHistory') return appConfig();
    await drop(req.peer, { mode: req.revoke === true ? 'revoke' : 'delete' });
    return affected();
  });
  const client = {
    getMe: vi.fn(async () => ME),
    call,
    resolvePeer: vi.fn(async (peer: unknown) => peer),
    iterDialogs,
    leaveChat,
    deleteHistory,
    getContacts,
    deleteContacts,
    getFolders,
    deleteFolder,
    ...over,
  };
  return {
    client: client as unknown as TelegramClient,
    iterDialogs,
    leaveChat,
    deleteHistory,
    getContacts,
    deleteContacts,
    getFolders,
    deleteFolder,
  };
};

/** Runs a cleanup without waiting out the pause between dialogs. */
const run = async (
  client: TelegramClient,
  options = OPTIONS,
  signal?: AbortSignal,
  extras: {
    report?: (step: TelegramTaskStep, waitSeconds?: number | null) => void;
    keepAlive?: () => void;
  } = {},
) => {
  vi.useFakeTimers();
  const pending = cleanupTelegramAccount(
    client,
    options,
    extras.report ?? (() => undefined),
    signal,
    extras.keepAlive,
  );
  await vi.runAllTimersAsync();
  return await pending;
};

/** What Telegram actually sends back, rather than what it looks like on the wire. */
const flood = (seconds: number) =>
  tl.RpcError.fromTl({ _: 'rpc_error', errorCode: 420, errorMessage: `FLOOD_WAIT_${seconds}` });

afterEach(() => {
  vi.useRealTimers();
});

describe('cleanupTelegramAccount', () => {
  it('leaves chats and channels, deletes conversations and bots', async () => {
    const { client, leaveChat, deleteHistory } = clientWith([
      { id: 1, type: 'chat', chatType: 'channel' },
      { id: 2, type: 'chat', chatType: 'supergroup' },
      { id: 3, type: 'user', isBot: true },
      { id: 4, type: 'user' },
    ]);
    const { result } = await run(client);
    expect(result).toEqual({ scanned: 4, left: 2, deleted: 2, contacts: 0, folders: 0, failed: 0 });
    expect(leaveChat).toHaveBeenCalledTimes(2);
    // No second argument any more.
    expect(leaveChat.mock.calls[0]?.[1]).toBeUndefined();
    expect(deleteHistory).toHaveBeenCalledTimes(2);
    // Off by default in these options: the other side's copy is not ours to erase unless the run was told to.
    expect(deleteHistory.mock.calls[0]?.[1]).toEqual({ mode: 'delete' });
  });

  /** The log this came from: ninety legacy groups left. */
  it('empties a legacy group behind itself, because leaving does not remove it', async () => {
    const { client, leaveChat, deleteHistory } = clientWith([
      { id: -1, type: 'chat', chatType: 'group' },
    ]);
    const { result } = await run(client);

    expect(result).toEqual({ scanned: 1, left: 1, deleted: 0, contacts: 0, folders: 0, failed: 0 });
    expect(leaveChat).toHaveBeenCalledTimes(1);
    // Counted as `left`, not as `deleted`: the emptying is how a departure is finished.
    expect(deleteHistory).toHaveBeenCalledTimes(1);
    expect(deleteHistory.mock.calls[0]?.[1]).toEqual({ mode: 'delete' });
  });

  // The other half of the same rule.
  it('does not chase a supergroup or a channel with a history delete', async () => {
    const { client, deleteHistory } = clientWith([
      { id: -2, type: 'chat', chatType: 'supergroup' },
      { id: -3, type: 'chat', chatType: 'channel' },
      { id: -4, type: 'chat', chatType: 'gigagroup' },
    ]);
    const { result } = await run(client);

    expect(result.left).toBe(3);
    expect(deleteHistory).not.toHaveBeenCalled();
  });

  // A departure is irreversible and the emptying behind it is not.
  it('does not walk out of a group twice when the emptying behind it has to wait', async () => {
    const order: string[] = [];
    const leaveChat = vi.fn(async (peer: { id: number }) => {
      order.push(`leave:${peer.id}`);
    });
    const deleteHistory = vi.fn(async (peer: { id: number }) => {
      order.push(`delete:${peer.id}`);
      if (deleteHistory.mock.calls.length === 1) throw flood(60);
    });
    const { client } = clientWith([{ id: -1, type: 'chat', chatType: 'group' }], {
      leaveChat,
      deleteHistory,
    });
    const { result } = await run(client);

    expect(order).toEqual(['leave:-1', 'delete:-1', 'delete:-1']);
    expect(result).toEqual({ scanned: 1, left: 1, deleted: 0, contacts: 0, folders: 0, failed: 0 });
  });

  // «Удаляем только у себя» is the outcome nobody means by «удалить переписку» on an account that is changing hands.
  it('erases the other side of a private chat too when asked, but never a bot', async () => {
    const { client, deleteHistory } = clientWith([
      { id: 4, type: 'user' },
      { id: 3, type: 'user', isBot: true },
    ]);
    const { result } = await run(client, { ...OPTIONS, revokePrivate: true });

    expect(result).toEqual({ scanned: 2, left: 0, deleted: 2, contacts: 0, folders: 0, failed: 0 });
    expect(deleteHistory.mock.calls[0]?.[1]).toEqual({ mode: 'revoke' });
    // A bot keeps its half of the conversation whatever we send.
    expect(deleteHistory.mock.calls[1]?.[1]).toEqual({ mode: 'delete' });
  });

  /** The log this pair came from: `private/delete user #731136919` and `bots/delete user #117678843`. */
  it('keeps emptying a long history until the server says none is left', async () => {
    let rest = 3;
    const call = vi.fn(async (req: { _: string }) => {
      if (req._ !== 'messages.deleteHistory') return appConfig();
      rest -= 1;
      return affected(rest);
    });
    const { client } = clientWith([{ id: 1, type: 'user' }], { call });
    const { result } = await run(client);

    expect(call.mock.calls.filter((it) => it[0]._ === 'messages.deleteHistory')).toHaveLength(3);
    expect(result).toEqual({ scanned: 1, left: 0, deleted: 1, contacts: 0, folders: 0, failed: 0 });
  });

  // One end of that loop.
  it('stops emptying a history that never ends, and says so', async () => {
    vi.mocked(log.warn).mockClear();
    let rest = 1_000;
    const call = vi.fn(async (req: { _: string }) => {
      if (req._ !== 'messages.deleteHistory') return appConfig();
      rest -= 1;
      return affected(rest);
    });
    const { client } = clientWith([{ id: 1, type: 'user' }], { call });
    const { result } = await run(client);

    expect(call.mock.calls.filter((it) => it[0]._ === 'messages.deleteHistory')).toHaveLength(200);
    expect(result.deleted).toBe(1);
    expect(vi.mocked(log.warn).mock.calls.map(String).join('\n')).toContain('user #1 outlasted');
  });

  // The other end, and the reason the ceiling above could be raised at all.
  it('gives up as soon as the remainder stops shrinking', async () => {
    vi.mocked(log.warn).mockClear();
    const call = vi.fn(async (req: { _: string }) =>
      req._ === 'messages.deleteHistory' ? affected(7) : appConfig(),
    );
    const { client } = clientWith([{ id: 1, type: 'user' }], { call });
    await run(client);

    expect(call.mock.calls.filter((it) => it[0]._ === 'messages.deleteHistory')).toHaveLength(2);
    expect(vi.mocked(log.warn).mock.calls.map(String).join('\n')).toContain(
      'user #1 stopped shrinking at 7',
    );
  });

  // These two used to be hard-coded as untouchable, and on an account that is changing hands that was the wrong call.
  it('leaves Saved Messages, the service chat and support alone when they are not selected', async () => {
    const { client, leaveChat, deleteHistory } = clientWith([
      { id: ME.id, type: 'user' },
      { id: 777_000, type: 'user' },
      { id: 42, type: 'user', isSupport: true },
    ]);
    const { result } = await run(client);
    expect(result).toEqual({ scanned: 3, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 0 });
    expect(leaveChat).not.toHaveBeenCalled();
    expect(deleteHistory).not.toHaveBeenCalled();
  });

  // Saved Messages is the dialog with ourselves.
  it('clears Saved Messages and the service chats when they are', async () => {
    const { client, deleteHistory } = clientWith([
      { id: ME.id, type: 'user' },
      { id: 777_000, type: 'user' },
      { id: 42, type: 'user', isSupport: true },
    ]);
    const { result } = await run(client, { ...OPTIONS, targets: ['saved', 'service'] });
    expect(result).toEqual({ scanned: 3, left: 0, deleted: 3, contacts: 0, folders: 0, failed: 0 });
    expect(deleteHistory).toHaveBeenCalledTimes(3);
    // Never `revoke`, whatever the run was told: there is nobody on the other side of a note to oneself.
    for (const call of deleteHistory.mock.calls) expect(call[1]).toEqual({ mode: 'delete' });
  });

  // `revoke` belongs to `private` and to nothing else.
  it('never revokes Saved Messages, even on a run that revokes private chats', async () => {
    const { client, deleteHistory } = clientWith([{ id: ME.id, type: 'user' }]);
    await run(client, { ...OPTIONS, targets: ['saved', 'private'], revokePrivate: true });
    expect(deleteHistory.mock.calls[0]?.[1]).toEqual({ mode: 'delete' });
  });

  it('acts on the chosen kinds only, and counts the rest as looked at', async () => {
    const { client, leaveChat, deleteHistory } = clientWith([
      { id: 1, type: 'chat', chatType: 'channel' },
      { id: 2, type: 'user' },
    ]);
    const { result } = await run(client, { ...OPTIONS, targets: ['channels'] });
    expect(result).toEqual({ scanned: 2, left: 1, deleted: 0, contacts: 0, folders: 0, failed: 0 });
    expect(leaveChat).toHaveBeenCalledTimes(1);
    expect(deleteHistory).not.toHaveBeenCalled();
  });

  // A monoforum is a channel's «Сообщения» inbox, not a subscription.
  it('leaves a monoforum under the channels switch', async () => {
    const { client, leaveChat, deleteHistory } = clientWith([
      { id: 9, type: 'chat', chatType: 'monoforum' },
    ]);
    const { result } = await run(client, { ...OPTIONS, targets: ['channels'] });
    expect(deleteHistory).not.toHaveBeenCalled();
    expect(leaveChat).toHaveBeenCalledTimes(1);
    expect(result.left).toBe(1);
    expect(result.failed).toBe(0);
  });

  // The switch it answers to has to be the one a user would look for it under.
  it('leaves a monoforum alone when the channels switch is off', async () => {
    const { client, leaveChat } = clientWith([{ id: 9, type: 'chat', chatType: 'monoforum' }]);
    const { result } = await run(client, { ...OPTIONS, targets: ['private'] });
    expect(leaveChat).not.toHaveBeenCalled();
    expect(result.left).toBe(0);
  });

  // Right by the schema and by what Telegram's own client does is not the same as having watched the server accept it.
  it('says how the monoforum call actually went', async () => {
    vi.mocked(log.info).mockClear();
    const { client } = clientWith([
      { id: 9, type: 'chat', chatType: 'monoforum' },
      { id: 10, type: 'chat', chatType: 'monoforum' },
    ]);
    await run(client, { ...OPTIONS, targets: ['channels'] });
    const said = vi
      .mocked(log.info)
      .mock.calls.map(String)
      .filter((it) => it.includes('monoforum'));
    // One line, not one per inbox: the first already makes the point.
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('#9');
    expect(said[0]).toContain('leave → ok');
  });

  // The other half of the same promise: a refusal reaches the log with the reason attached.
  it('says so when the monoforum call is refused, and why', async () => {
    vi.mocked(log.info).mockClear();
    const leaveChat = vi.fn().mockRejectedValue(new Error('PEER_ID_INVALID'));
    const { client } = clientWith([{ id: 9, type: 'chat', chatType: 'monoforum' }], { leaveChat });
    const { result } = await run(client, { ...OPTIONS, targets: ['channels'] });
    expect(result.failed).toBe(1);
    const said = vi
      .mocked(log.info)
      .mock.calls.map(String)
      .filter((it) => it.includes('monoforum'));
    expect(said[0]).toContain('refused');
    expect(said[0]).toContain('PEER_ID_INVALID');
  });

  // A chat kind Telegram invented after this was written is not a subscription the user asked to drop.
  it('skips a peer kind it does not recognise, and says which', async () => {
    vi.mocked(log.warn).mockClear();
    const { client, leaveChat } = clientWith([{ id: 9, type: 'chat', chatType: 'hyperforum' }]);
    const { result } = await run(client);
    expect(result.scanned).toBe(1);
    expect(result.left).toBe(0);
    expect(leaveChat).not.toHaveBeenCalled();
    // The kind and the peer id both: «какой-то бот остался» is only answerable if the line says what it was and which one.
    expect(vi.mocked(log.warn).mock.calls.map(String).join('\n')).toContain('hyperforum #9');
  });

  // The arithmetic the user does in their head — `scanned` minus what was removed — has to close.
  it('accounts for every dialog it looked at but did not act on', async () => {
    vi.mocked(log.info).mockClear();
    const { client } = clientWith([
      { id: 1, type: 'chat', chatType: 'channel' },
      { id: 2, type: 'user' },
      { id: 9, type: 'chat', chatType: 'hyperforum' },
    ]);
    await run(client, { ...OPTIONS, targets: ['channels'] });
    const line = vi.mocked(log.info).mock.calls.map(String).join('\n');
    // Three scanned, one left, one held back by the switches, one unrecognised.
    expect(line).toContain('scanned=3');
    expect(line).toContain('kept=1');
    expect(line).toContain('unknown=1');
  });

  // `keep` reads like «both folders» and is not.
  it('walks each folder by name, and the pinned dialogs apart from the rest', async () => {
    const { client, iterDialogs } = clientWith([]);
    await run(client);
    expect(iterDialogs.mock.calls.map((c) => c[0])).toEqual([
      { archived: 'exclude', pinned: 'exclude' },
      { archived: 'exclude', pinned: 'only' },
    ]);

    const second = clientWith([]);
    await run(second.client, { ...OPTIONS, includeArchived: true });
    expect(second.iterDialogs.mock.calls.map((c) => c[0])).toEqual([
      { archived: 'exclude', pinned: 'exclude' },
      { archived: 'exclude', pinned: 'only' },
      { archived: 'only', pinned: 'exclude' },
      { archived: 'only', pinned: 'only' },
    ]);
  });

  // The shape of the bug this separation fixes, in miniature: the main list never offers the pin.
  it('sweeps a pinned channel the main list never offers', async () => {
    const iterDialogs = vi.fn((params: { pinned: string }) =>
      dialogs(
        params.pinned === 'only' ? [{ id: 1, type: 'chat' as const, chatType: 'channel' }] : [],
      ),
    );
    const { client, leaveChat } = clientWith([], { iterDialogs });
    const { result } = await run(client);

    expect(leaveChat).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ scanned: 1, left: 1, deleted: 0, contacts: 0, folders: 0, failed: 0 });
  });

  // A dialog emptied by a sweep sorts below the cursor that emptied it and is never offered again.
  it('reads again until a pass finds nothing new, without acting twice', async () => {
    const { client, leaveChat, iterDialogs } = clientWith([
      { id: 1, type: 'chat', chatType: 'channel' },
      { id: 2, type: 'chat', chatType: 'channel' },
    ]);
    const { result } = await run(client);
    // The fake hands over the same two dialogs on every read.
    expect(iterDialogs).toHaveBeenCalledTimes(4);
    expect(leaveChat).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, left: 2, deleted: 0, contacts: 0, folders: 0, failed: 0 });
  });

  // The blind spot the counters had until now.
  it('counts a dialog that survived the call it accepted', async () => {
    vi.mocked(log.info).mockClear();
    vi.mocked(log.warn).mockClear();
    // The fake never drops what it was asked to drop — which is the pathological server this counter exists to catch.
    const { client, leaveChat } = clientWith([{ id: 1, type: 'chat', chatType: 'channel' }]);
    const { result } = await run(client);

    expect(leaveChat).toHaveBeenCalledTimes(1);
    // Still counted as left: the call was accepted, and that is what `left` says.
    expect(result.left).toBe(1);
    expect(result.failed).toBe(0);
    expect(vi.mocked(log.info).mock.calls.map(String).join('\n')).toContain('stayed=1');
    // The branch and the peer both: «user #… остался» could be a private chat that refused, a bot that keeps its own dialog.
    expect(vi.mocked(log.warn).mock.calls.map(String).join('\n')).toContain(
      'channels/leave channel #1',
    );
  });

  // «Избранное» is the account's chat with itself.
  it('does not count saved messages as having stayed', async () => {
    vi.mocked(log.info).mockClear();
    vi.mocked(log.warn).mockClear();
    const { client, deleteHistory } = clientWith([{ id: ME.id, type: 'user' }]);
    const { result } = await run(client, { ...OPTIONS, targets: ['saved'] });

    expect(deleteHistory).toHaveBeenCalledTimes(1);
    expect(result.deleted).toBe(1);
    expect(vi.mocked(log.info).mock.calls.map(String).join('\n')).toContain('stayed=0');
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled();
  });

  it('says nothing stayed when the dialog really goes', async () => {
    vi.mocked(log.info).mockClear();
    let gone = false;
    const iterDialogs = vi.fn(() =>
      dialogs(gone ? [] : [{ id: 1, type: 'chat' as const, chatType: 'channel' }]),
    );
    const leaveChat = vi.fn(async () => {
      gone = true;
    });
    const { client } = clientWith([], { iterDialogs, leaveChat });
    const { result } = await run(client);

    expect(result.left).toBe(1);
    expect(vi.mocked(log.info).mock.calls.map(String).join('\n')).toContain('stayed=0');
  });

  // A flood wait is an appointment, not a survivor: the dialog is still listed because nothing has been done to it yet.
  it('does not count a flood-deferred dialog as having stayed', async () => {
    vi.mocked(log.info).mockClear();
    const alive = new Set([1, 2]);
    const iterDialogs = vi.fn(() =>
      dialogs([...alive].map((id) => ({ id, type: 'chat' as const, chatType: 'channel' }))),
    );
    // The first goes; the second is put off for an hour.
    const leaveChat = vi.fn(async (peer: { id: number }) => {
      if (peer.id === 2) throw flood(60 * 60);
      alive.delete(peer.id);
    });
    const { client } = clientWith([], { iterDialogs, leaveChat });
    const { result } = await run(client);

    expect(result.left).toBe(1);
    expect(result.failed).toBe(1);
    expect(vi.mocked(log.info).mock.calls.map(String).join('\n')).toContain('stayed=0');
  });

  // The bug that made this file read before it writes, in miniature: the writes move the pagination cursor.
  it('does not write while the list is still being read', async () => {
    const order: string[] = [];
    // Only the main list holds anything, so the pinned walk is one empty call and the order below is about the one thing.
    const iterDialogs = vi.fn((params: { pinned: string }) => ({
      async *[Symbol.asyncIterator]() {
        if (params.pinned === 'only') return;
        for (const id of [1, 2, 3]) {
          order.push(`read:${id}`);
          yield { peer: { id, type: 'chat', chatType: 'channel', isBot: false, isSupport: false } };
        }
      },
    }));
    const leaveChat = vi.fn(async (peer: { id: number }) => {
      order.push(`leave:${peer.id}`);
    });
    const { client } = clientWith([], { iterDialogs, leaveChat });
    await run(client);

    expect(order.slice(0, 3)).toEqual(['read:1', 'read:2', 'read:3']);
    expect(order.slice(3, 6)).toEqual(['leave:1', 'leave:2', 'leave:3']);
  });

  it('counts one stubborn dialog and keeps going', async () => {
    const leaveChat = vi
      .fn()
      .mockRejectedValueOnce(new tl.RpcError(400, 'CHANNEL_PRIVATE'))
      .mockResolvedValueOnce(undefined);
    const { client } = clientWith(
      [
        { id: 1, type: 'chat', chatType: 'channel' },
        { id: 2, type: 'chat', chatType: 'channel' },
      ],
      { leaveChat },
    );
    const { result } = await run(client);
    expect(result).toEqual({ scanned: 2, left: 1, deleted: 0, contacts: 0, folders: 0, failed: 1 });
    expect(leaveChat).toHaveBeenCalledTimes(2);
  });

  /** The bug this whole half exists for. */
  it('waits out a flood wait and comes back for the group', async () => {
    const leaveChat = vi.fn().mockRejectedValueOnce(flood(120)).mockResolvedValueOnce(undefined);
    const { client } = clientWith([{ id: 1, type: 'chat', chatType: 'group' }], { leaveChat });

    const { result } = await run(client);

    expect(leaveChat).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 1, left: 1, deleted: 0, contacts: 0, folders: 0, failed: 0 });
  });

  // Obeying must not turn into an hour.
  it('gives up on a wait it cannot afford and says the account is not finished', async () => {
    const leaveChat = vi.fn(async () => Promise.reject(flood(3600)));
    const { client } = clientWith([{ id: 1, type: 'chat', chatType: 'group' }], { leaveChat });

    const { result } = await run(client);

    expect(leaveChat).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ scanned: 1, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 1 });
  });

  /** A block is per method, not per account. */
  it('puts the blocked dialog aside and carries on with the rest', async () => {
    const order: string[] = [];
    const leaveChat = vi.fn(async (peer: { id: number }) => {
      order.push(`leave:${peer.id}`);
      if (leaveChat.mock.calls.length === 1) throw flood(90);
    });
    const deleteHistory = vi.fn(async (peer: { id: number }) => {
      order.push(`delete:${peer.id}`);
    });
    const { client } = clientWith(
      [
        { id: 1, type: 'chat', chatType: 'group' },
        { id: 2, type: 'user' },
      ],
      { leaveChat, deleteHistory },
    );

    const { result } = await run(client);

    // The trailing `delete:1` is the group's own removal from the list.
    expect(order).toEqual(['leave:1', 'delete:2', 'leave:1', 'delete:1']);
    expect(result).toEqual({ scanned: 2, left: 1, deleted: 1, contacts: 0, folders: 0, failed: 0 });
  });

  /** A wait we chose is not a dead socket. */
  it('tells the watchdog that a long wait is deliberate', async () => {
    const keepAlive = vi.fn();
    const leaveChat = vi.fn().mockRejectedValueOnce(flood(150)).mockResolvedValueOnce(undefined);
    const { client } = clientWith([{ id: 1, type: 'chat', chatType: 'group' }], { leaveChat });

    await run(client, OPTIONS, undefined, { keepAlive });

    // 150s in half-minute slices: the point is «not once, and not never», not the exact count.
    expect(keepAlive.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  // The panel says «ждём 150 с» rather than «ждём…».
  it('says how long it is waiting for', async () => {
    const report = vi.fn();
    const leaveChat = vi.fn().mockRejectedValueOnce(flood(150)).mockResolvedValueOnce(undefined);
    const { client } = clientWith([{ id: 1, type: 'chat', chatType: 'group' }], { leaveChat });

    await run(client, OPTIONS, undefined, { report });

    const waiting = report.mock.calls.find(([step]) => step === 'waiting');
    expect(waiting?.[1]).toBeGreaterThanOrEqual(150);
  });

  // «Отмена» must not have to outlast a flood wait.
  it('stops in the middle of a flood wait when the run is called off', async () => {
    const ctl = new AbortController();
    const leaveChat = vi.fn(async () => {
      ctl.abort();
      return Promise.reject(flood(240));
    });
    const { client } = clientWith([{ id: 1, type: 'chat', chatType: 'group' }], { leaveChat });

    const { result } = await run(client, OPTIONS, ctl.signal);

    expect(leaveChat).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
  });

  // Every remaining dialog would refuse the same way, and the freeze — not a count of failures — is the news.
  it('stops on a freeze that surfaces on the first write', async () => {
    const { client } = clientWith(
      [
        { id: 1, type: 'chat', chatType: 'channel' },
        { id: 2, type: 'chat', chatType: 'channel' },
      ],
      {
        leaveChat: vi.fn(async () => Promise.reject(new tl.RpcError(400, 'FROZEN_METHOD_INVALID'))),
      },
    );
    const { result, info } = await run(client);
    expect(info.status).toBe('frozen');
    expect(result).toEqual({ scanned: 2, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 0 });
  });

  // A cancel the queue understands and this loop did not: the queue's own stops the *next* account.
  it('stops at the next dialog when the run is called off', async () => {
    const ctl = new AbortController();
    const { client, leaveChat } = clientWith(
      Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        type: 'chat' as const,
        chatType: 'channel',
      })),
    );
    // Called off while the third one is being left.
    leaveChat.mockImplementation(async () => {
      if (leaveChat.mock.calls.length >= 3) ctl.abort();
    });

    const { result } = await run(client, OPTIONS, ctl.signal);

    // What it managed is reported rather than thrown away: three channels are genuinely gone.
    expect(result.left).toBe(3);
    expect(result.scanned).toBe(20);
    expect(leaveChat).toHaveBeenCalledTimes(3);
  });

  it('does not even start when it is handed a signal that has already fired', async () => {
    const { client, leaveChat } = clientWith([{ id: 1, type: 'chat', chatType: 'channel' }]);
    const { result, info } = await run(client, OPTIONS, AbortSignal.abort());

    expect(leaveChat).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 0 });
    // Still the account it read at the start — the row has something to show.
    expect(info.status).toBe('alive');
  });

  it('reports a freeze the app config admits before touching anything', async () => {
    const { client, leaveChat } = clientWith([{ id: 1, type: 'chat', chatType: 'channel' }], {
      call: vi.fn(async () => appConfig({ freeze_since_date: { _: 'jsonNumber', value: 1 } })),
    });
    const { result, info } = await run(client);
    expect(info.status).toBe('frozen');
    expect(result).toEqual({ scanned: 0, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 0 });
    expect(leaveChat).not.toHaveBeenCalled();
  });

  // The log this came from: forty «Client is destroyed» warnings, each with a third of a second of pause after it.
  it('stops when the connection is gone rather than blaming the dialogs', async () => {
    const leaveChat = vi.fn(async () => Promise.reject(new Error('Client is destroyed')));
    const { client } = clientWith(
      Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        type: 'chat' as const,
        chatType: 'channel',
      })),
      { leaveChat },
    );
    vi.useFakeTimers();
    // No timers to drain: the throw happens on the first write, before the first pause between two of them is ever reached.
    await expect(cleanupTelegramAccount(client, OPTIONS, () => undefined)).rejects.toThrow(
      'Client is destroyed',
    );
    expect(leaveChat).toHaveBeenCalledTimes(1);
  });

  it('reports a dead key as a dead key, not as a cleanup that did nothing', async () => {
    const { client } = clientWith([], {
      getMe: vi.fn(async () => Promise.reject(new tl.RpcError(401, 'AUTH_KEY_UNREGISTERED'))),
    });
    const { result, info } = await run(client);
    expect(info.status).toBe('dead');
    expect(result).toEqual({ scanned: 0, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 0 });
  });

  /** The address book, which is not a dialog and is not reached by emptying one. */
  it('empties the address book in as few requests as the method allows', async () => {
    const book = Array.from({ length: 250 }, (_, i) => person(i + 1));
    const { client, deleteContacts, iterDialogs } = clientWith([], {
      getContacts: vi.fn(async () => book),
    });
    const { result } = await run(client, { ...OPTIONS, targets: ['contacts'] });

    // 250 names, 100 to a request: three calls, not two hundred and fifty.
    expect(deleteContacts).toHaveBeenCalledTimes(3);
    expect(deleteContacts.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    expect(result.contacts).toBe(250);
    // Nothing selected names a dialog, so the list is never read.
    expect(iterDialogs).not.toHaveBeenCalled();
  });

  // Counted by what Telegram says it removed, not by what was asked for — a name already gone is not one this run took off.
  it('counts the contacts Telegram says it removed, not the ones it was handed', async () => {
    const { client } = clientWith([], {
      getContacts: vi.fn(async () => [person(1), person(2), person(3)]),
      deleteContacts: vi.fn(async () => [person(1)]),
    });
    const { result } = await run(client, { ...OPTIONS, targets: ['contacts'] });
    expect(result.contacts).toBe(1);
  });

  // Both halves of a full run, and in this order.
  it('clears contacts before it touches the dialogs', async () => {
    const order: string[] = [];
    const { client } = clientWith([{ id: 1, type: 'chat', chatType: 'channel' }], {
      getContacts: vi.fn(async () => {
        order.push('contacts');
        return [person(1)];
      }),
      iterDialogs: vi.fn(() => {
        order.push('dialogs');
        return dialogs([{ id: 1, type: 'chat' as const, chatType: 'channel' }]);
      }),
    });
    const { result } = await run(client, { ...OPTIONS, targets: [...ALL, 'contacts'] });

    expect(order[0]).toBe('contacts');
    expect(order[1]).toBe('dialogs');
    expect(result).toEqual({ scanned: 1, left: 1, deleted: 0, contacts: 1, folders: 0, failed: 0 });
  });

  // One refused chunk is not the whole address book, and it is not the run.
  it('counts a refused chunk of contacts and keeps the dialogs', async () => {
    const { client, leaveChat } = clientWith([{ id: 1, type: 'chat', chatType: 'channel' }], {
      getContacts: vi.fn(async () => [person(1)]),
      deleteContacts: vi.fn(async () => Promise.reject(new tl.RpcError(400, 'PEER_ID_INVALID'))),
    });
    const { result } = await run(client, { ...OPTIONS, targets: [...ALL, 'contacts'] });

    expect(result.contacts).toBe(0);
    expect(result.failed).toBe(1);
    expect(leaveChat).toHaveBeenCalledTimes(1);
  });

  // A freeze on the cheap call is the whole news, and it saves the long walk.
  it('stops before the dialogs when the address book answers frozen', async () => {
    const { client, iterDialogs } = clientWith([{ id: 1, type: 'chat', chatType: 'channel' }], {
      getContacts: vi.fn(async () => Promise.reject(new tl.RpcError(400, 'FROZEN_METHOD_INVALID'))),
    });
    const { result, info } = await run(client, { ...OPTIONS, targets: [...ALL, 'contacts'] });

    expect(info.status).toBe('frozen');
    expect(result).toEqual({ scanned: 0, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 0 });
    expect(iterDialogs).not.toHaveBeenCalled();
  });

  /** Folders: the tabs across the top, which outlive everything that was in them. */
  it('removes every folder the account has, and nothing else', async () => {
    const { client, deleteFolder, iterDialogs, leaveChat } = clientWith([], {
      getFolders: vi.fn(async () => ({ filters: [folder(2), folder(7), folder(11)] })),
    });
    const { result } = await run(client, { ...OPTIONS, targets: ['folders'] });

    expect(result.folders).toBe(3);
    expect(deleteFolder.mock.calls.map((c) => c[0])).toEqual([2, 7, 11]);
    // Nothing selected names a dialog, so the list is never read at all.
    expect(iterDialogs).not.toHaveBeenCalled();
    expect(leaveChat).not.toHaveBeenCalled();
  });

  // «Все чаты» is not a folder anyone made — Telegram sends it only so a reorder can say where the default sits.
  it('leaves the default «all chats» entry alone', async () => {
    const { client, deleteFolder } = clientWith([], {
      getFolders: vi.fn(async () => ({ filters: [folder(0, 'dialogFilterDefault'), folder(3)] })),
    });
    const { result } = await run(client, { ...OPTIONS, targets: ['folders'] });

    expect(result.folders).toBe(1);
    expect(deleteFolder).toHaveBeenCalledTimes(1);
    expect(deleteFolder.mock.calls[0]?.[0]).toBe(3);
  });

  // The other half of the switch, and the one a user is likelier to want: the previous owner's channels gone.
  it('keeps the folders when they were not asked for', async () => {
    const { client, deleteFolder, getFolders } = clientWith(
      [{ id: 1, type: 'chat', chatType: 'channel' }],
      { getFolders: vi.fn(async () => ({ filters: [folder(2)] })) },
    );
    const { result } = await run(client);

    expect(result.folders).toBe(0);
    // Not even read: a list nobody is going to act on is a request for nothing.
    expect(getFolders).not.toHaveBeenCalled();
    expect(deleteFolder).not.toHaveBeenCalled();
  });

  // One folder refusing is one folder, and the dialogs behind it are still the point of the run.
  it('counts a refused folder and keeps going', async () => {
    let call = 0;
    const { client, leaveChat } = clientWith([{ id: 1, type: 'chat', chatType: 'channel' }], {
      getFolders: vi.fn(async () => ({ filters: [folder(2), folder(3)] })),
      deleteFolder: vi.fn(async () => {
        call += 1;
        if (call === 1) throw new tl.RpcError(400, 'FILTER_ID_INVALID');
        return undefined;
      }),
    });
    const { result } = await run(client, { ...OPTIONS, targets: [...ALL, 'folders'] });

    expect(result.folders).toBe(1);
    expect(result.failed).toBe(1);
    expect(leaveChat).toHaveBeenCalledTimes(1);
  });

  // A failure that says nothing about the account has to reach the runner, which is the only thing that can retry it.
  it('lets an unrelated failure out', async () => {
    const { client } = clientWith([], {
      getMe: vi.fn(async () => Promise.reject(new tl.RpcError(500, 'RPC_CALL_FAIL'))),
    });
    vi.useFakeTimers();
    await expect(cleanupTelegramAccount(client, OPTIONS, () => undefined)).rejects.toThrow();
  });
});

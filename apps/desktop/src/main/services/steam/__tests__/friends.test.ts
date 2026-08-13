import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getGuardAccessToken = vi.fn();
const getGuardWebCookies = vi.fn();
const guardHttp = vi.fn();

vi.mock('../../steam-guard/session', () => ({
  getGuardAccessToken,
  getGuardWebCookies,
  getGuardSteamId: (record: { steamId: string }) => record.steamId,
}));

vi.mock('../../steam-guard/http', () => ({ guardHttp }));

const { EFriendRelationship, friendTargetOf, parseFriendsList, purgeSteamFriends, wroteThrough } =
  await import('../friends');

const RECORD = { steamId: '76561198000000001' } as never;

/** Nobody is kept waiting in a test; the pause is the engine's, not the point. */
const CTX = { report: () => undefined, paceMs: 0 };

const listBody = (entries: readonly { id: string; rel: number }[]): string =>
  JSON.stringify({
    response: {
      friendslist: {
        friends: entries.map((e) => ({ ulfriendid: e.id, efriendrelationship: e.rel })),
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  getGuardAccessToken.mockResolvedValue({ ok: true, token: 'access', record: RECORD });
  getGuardWebCookies.mockResolvedValue({
    ok: true,
    cookies: ['sessionid=abc123', 'steamLoginSecure=76561198000000001%7C%7Ctoken'],
  });
});

describe('parseFriendsList', () => {
  // The distinction the whole operation rests.
  it('reads an account with no friends as an empty list, not a failure', () => {
    expect(parseFriendsList('{"response":{}}')).toEqual([]);
    expect(parseFriendsList('{"response":{"friendslist":{}}}')).toEqual([]);
  });

  it('reads a body that is not this endpoint as null', () => {
    expect(parseFriendsList('<html>login</html>')).toBeNull();
    expect(parseFriendsList('null')).toBeNull();
    expect(parseFriendsList('{"friends":[]}')).toBeNull();
  });

  // steamID64 does not survive a `number`, so it is never made into one.
  it('keeps ids as strings and drops entries that are not ids', () => {
    const body = JSON.stringify({
      response: {
        friendslist: {
          friends: [
            { ulfriendid: '76561198012345678', efriendrelationship: 3 },
            { ulfriendid: 'not-an-id', efriendrelationship: 3 },
            { efriendrelationship: 3 },
            { ulfriendid: '76561198087654321' },
          ],
        },
      },
    });
    expect(parseFriendsList(body)).toEqual([
      { steamId: '76561198012345678', relationship: 3 },
      { steamId: '76561198087654321', relationship: EFriendRelationship.None },
    ]);
  });
});

describe('friendTargetOf', () => {
  it('treats a muted friend as a friend', () => {
    expect(friendTargetOf(EFriendRelationship.Friend)).toBe('friends');
    expect(friendTargetOf(EFriendRelationship.IgnoredFriend)).toBe('friends');
  });

  it('separates the two directions of an invite', () => {
    expect(friendTargetOf(EFriendRelationship.RequestRecipient)).toBe('incoming');
    expect(friendTargetOf(EFriendRelationship.RequestInitiator)).toBe('outgoing');
  });

  // This operation's output, not its input: re-blocking what is blocked would make every second run report work it did not.
  it('claims nothing that is already blocked or ignored', () => {
    expect(friendTargetOf(EFriendRelationship.Blocked)).toBeNull();
    expect(friendTargetOf(EFriendRelationship.Ignored)).toBeNull();
    expect(friendTargetOf(EFriendRelationship.None)).toBeNull();
    expect(friendTargetOf(99)).toBeNull();
  });
});

describe('wroteThrough', () => {
  it('takes silence and unknown shapes for success', () => {
    expect(wroteThrough('')).toBe(true);
    expect(wroteThrough('   ')).toBe(true);
    expect(wroteThrough('true')).toBe(true);
    expect(wroteThrough('{"success":1}')).toBe(true);
    expect(wroteThrough('{"success":true}')).toBe(true);
    // The day Steam drops the field, a full run must not report every removal as failed while the list empties out behind it.
    expect(wroteThrough('{"nothing":"we know"}')).toBe(true);
    expect(wroteThrough('<!DOCTYPE html>')).toBe(true);
  });

  it('believes an answer that says no', () => {
    expect(wroteThrough('false')).toBe(false);
    expect(wroteThrough('null')).toBe(false);
    expect(wroteThrough('0')).toBe(false);
    expect(wroteThrough('{"success":2}')).toBe(false);
  });
});

describe('purgeSteamFriends', () => {
  it('removes only the selected lists and counts the rest as kept', async () => {
    guardHttp.mockImplementation(async (req: { url: string }) =>
      req.url.includes('GetFriendsList')
        ? {
            status: 200,
            body: listBody([
              { id: '76561198000000002', rel: EFriendRelationship.Friend },
              { id: '76561198000000003', rel: EFriendRelationship.RequestRecipient },
              { id: '76561198000000004', rel: EFriendRelationship.RequestInitiator },
              { id: '76561198000000005', rel: EFriendRelationship.Blocked },
            ]),
          }
        : { status: 200, body: '{"success":1}' },
    );

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({ scanned: 4, removed: 1, blocked: 0, kept: 3, failed: 0 });
    const writes = guardHttp.mock.calls.filter(
      (call) => !String(call[0]?.url).includes('GetFriendsList'),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0].url).toContain('RemoveFriendAjax');
    expect(writes[0]?.[0].body).toBe('sessionID=abc123&steamid=76561198000000002');
  });

  it('posts to the block endpoint and counts blocked, not removed', async () => {
    guardHttp.mockImplementation(async (req: { url: string }) =>
      req.url.includes('GetFriendsList')
        ? { status: 200, body: listBody([{ id: '76561198000000002', rel: 3 }]) }
        : { status: 200, body: '' },
    );

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: true }, CTX);

    expect(outcome.result).toEqual({ scanned: 1, removed: 0, blocked: 1, kept: 0, failed: 0 });
    expect(guardHttp.mock.calls[1]?.[0].url).toContain('BlockUserAjax');
  });

  // Steam has been known to list the account itself.
  it('never writes against the account itself', async () => {
    guardHttp.mockImplementation(async (req: { url: string }) =>
      req.url.includes('GetFriendsList')
        ? { status: 200, body: listBody([{ id: '76561198000000001', rel: 3 }]) }
        : { status: 200, body: '' },
    );

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.result).toEqual({ scanned: 1, removed: 0, blocked: 0, kept: 1, failed: 0 });
    expect(guardHttp).toHaveBeenCalledTimes(1);
  });

  // Nothing to do is a finished run, and it must never mint cookies to prove it.
  it('stops before the writes when the selected lists are empty', async () => {
    guardHttp.mockResolvedValue({ status: 200, body: '{"response":{}}' });

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome).toEqual({
      result: { scanned: 0, removed: 0, blocked: 0, kept: 0, failed: 0 },
      failure: null,
    });
    expect(getGuardWebCookies).not.toHaveBeenCalled();
  });

  it('refreshes cookies once when a write is bounced, and counts the retry', async () => {
    let write = 0;
    guardHttp.mockImplementation(async (req: { url: string }) => {
      if (req.url.includes('GetFriendsList')) {
        return { status: 200, body: listBody([{ id: '76561198000000002', rel: 3 }]) };
      }
      write += 1;
      // First attempt is bounced to the login page; the retry after the refresh goes through, and neither counts as a failure.
      return write === 1 ? { status: 302, body: '' } : { status: 200, body: '{"success":1}' };
    });

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.failure).toBeNull();
    expect(outcome.result).toEqual({ scanned: 1, removed: 1, blocked: 0, kept: 0, failed: 0 });
    expect(getGuardWebCookies).toHaveBeenCalledTimes(2);
    expect(write).toBe(2);
  });

  it('gives up after a second bounce rather than walking the list', async () => {
    guardHttp.mockImplementation(async (req: { url: string }) =>
      req.url.includes('GetFriendsList')
        ? {
            status: 200,
            body: listBody([
              { id: '76561198000000002', rel: 3 },
              { id: '76561198000000003', rel: 3 },
              { id: '76561198000000004', rel: 3 },
            ]),
          }
        : { status: 302, body: '' },
    );

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.failure).toEqual({ reason: 'refused', detail: 'cookies_rejected' });
    expect(outcome.result.scanned).toBe(3);
    expect(outcome.result.removed).toBe(0);
  });

  // The counts that were already true are not undone by the write that failed.
  it('carries the writes it managed into a rate-limited stop', async () => {
    let write = 0;
    guardHttp.mockImplementation(async (req: { url: string }) => {
      if (req.url.includes('GetFriendsList')) {
        return {
          status: 200,
          body: listBody([
            { id: '76561198000000002', rel: 3 },
            { id: '76561198000000003', rel: 3 },
            { id: '76561198000000004', rel: 3 },
          ]),
        };
      }
      write += 1;
      return write === 1 ? { status: 200, body: '' } : { status: 429, body: '' };
    });

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.failure).toEqual({ reason: 'rate_limited' });
    expect(outcome.result).toEqual({ scanned: 3, removed: 1, blocked: 0, kept: 0, failed: 0 });
  });

  it('reports an account with no Guard link as such, without touching the network', async () => {
    getGuardAccessToken.mockResolvedValue({ ok: false, reason: 'not_linked' });

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.failure).toEqual({ reason: 'not_linked' });
    expect(guardHttp).not.toHaveBeenCalled();
  });

  // An API we cannot read must not pass for a friendless account.
  it('reports an unreadable list as unreachable', async () => {
    guardHttp.mockResolvedValue({ status: 200, body: '<html>bye</html>' });

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.failure).toEqual({ reason: 'unreachable', detail: 'unreadable_list' });
  });

  it('refuses to write without a sessionid rather than posting a hundred CSRF failures', async () => {
    getGuardWebCookies.mockResolvedValue({ ok: true, cookies: ['steamLoginSecure=x'] });
    guardHttp.mockImplementation(async (req: { url: string }) =>
      req.url.includes('GetFriendsList')
        ? { status: 200, body: listBody([{ id: '76561198000000002', rel: 3 }]) }
        : { status: 200, body: '' },
    );

    const outcome = await purgeSteamFriends(1, { targets: ['friends'], block: false }, CTX);

    expect(outcome.failure).toEqual({ reason: 'refused', detail: 'no_session_id' });
    expect(guardHttp).toHaveBeenCalledTimes(1);
  });

  it('stops on abort and keeps what it already wrote', async () => {
    const controller = new AbortController();
    let write = 0;
    guardHttp.mockImplementation(async (req: { url: string }) => {
      if (req.url.includes('GetFriendsList')) {
        return {
          status: 200,
          body: listBody([
            { id: '76561198000000002', rel: 3 },
            { id: '76561198000000003', rel: 3 },
          ]),
        };
      }
      write += 1;
      controller.abort();
      return { status: 200, body: '' };
    });

    const outcome = await purgeSteamFriends(
      1,
      { targets: ['friends'], block: false },
      {
        ...CTX,
        signal: controller.signal,
      },
    );

    expect(outcome.failure).toEqual({ reason: 'cancelled' });
    expect(outcome.result).toEqual({ scanned: 2, removed: 1, blocked: 0, kept: 0, failed: 0 });
    expect(write).toBe(1);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TimeFetcher, getSteamTime, getSteamTimeOffset, resetSteamTimeCache } from '../time';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const respond = (body: string, ok = true): TimeFetcher =>
  vi.fn(async () => ({ ok, text: async () => body }));

const serverTime = (seconds: number): string =>
  JSON.stringify({ response: { server_time: String(seconds), skew_tolerance_seconds: '60' } });

afterEach(() => {
  resetSteamTimeCache();
  vi.useRealTimers();
});

describe('getSteamTimeOffset', () => {
  it('measures how far the local clock trails Steam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const offset = await getSteamTimeOffset(respond(serverTime(1_700_000_045)));
    expect(offset).toBe(45);
  });

  it('measures a local clock that runs ahead as a negative offset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    expect(await getSteamTimeOffset(respond(serverTime(1_699_999_988)))).toBe(-12);
  });

  it('asks Steam once and reuses the answer', async () => {
    const fetcher = respond(serverTime(1_700_000_000));
    await getSteamTimeOffset(fetcher);
    await getSteamTimeOffset(fetcher);
    await getSteamTimeOffset(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent callers onto a single request', async () => {
    const fetcher = respond(serverTime(1_700_000_000));
    await Promise.all([
      getSteamTimeOffset(fetcher),
      getSteamTimeOffset(fetcher),
      getSteamTimeOffset(fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to the local clock instead of rejecting when Steam is unreachable', async () => {
    const boom: TimeFetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(getSteamTimeOffset(boom)).resolves.toBe(0);
  });

  it('falls back on an HTTP error and on a body it cannot read', async () => {
    await expect(getSteamTimeOffset(respond('', false))).resolves.toBe(0);
    resetSteamTimeCache();
    await expect(getSteamTimeOffset(respond('<html>nope</html>'))).resolves.toBe(0);
    resetSteamTimeCache();
    await expect(getSteamTimeOffset(respond('{"response":{}}'))).resolves.toBe(0);
  });

  it('does not retry a failure on every call', async () => {
    const boom: TimeFetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    await getSteamTimeOffset(boom);
    await getSteamTimeOffset(boom);
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

describe('getSteamTime', () => {
  it('reports the local clock shifted onto Steam', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    expect(await getSteamTime(respond(serverTime(1_700_000_045)))).toBe(1_700_000_045);
  });
});

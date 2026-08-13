import log from 'electron-log/main';

const QUERY_TIME_URL = 'https://api.steampowered.com/ITwoFactorService/QueryTime/v0001';

/** Steam's clock minus ours, in seconds. */
let offsetSeconds: number | null = null;
let inFlight: Promise<number> | null = null;
/** When the last attempt failed, don't retry on every tick of the code display. */
let retryAfter = 0;
const RETRY_COOLDOWN_MS = 60_000;

export type TimeFetcher = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

/** Electron's stack, so a system proxy is honoured; injectable for tests. */
const defaultFetcher: TimeFetcher = async (url) => {
  const { net } = await import('electron');
  return net.fetch(url, { method: 'POST' });
};

const parseServerTime = (body: string): number | null => {
  try {
    const value = (JSON.parse(body) as { response?: { server_time?: unknown } }).response
      ?.server_time;
    // Steam sends it as a string; a plain number would be valid too.
    const seconds = typeof value === 'string' ? Number(value) : value;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.floor(seconds);
  } catch {
    return null;
  }
};

const measureOffset = async (fetcher: TimeFetcher): Promise<number> => {
  const startedAt = Date.now();
  const resp = await fetcher(QUERY_TIME_URL);
  if (!resp.ok) throw new Error('query_time_http_error');
  const serverTime = parseServerTime(await resp.text());
  if (serverTime === null) throw new Error('query_time_bad_body');
  // Compare against the midpoint of the round trip: the reply describes a moment somewhere inside it.
  const midpoint = (startedAt + Date.now()) / 2 / 1000;
  return Math.round(serverTime - midpoint);
};

/** Seconds to add to the local clock to land on Steam's. */
export const getSteamTimeOffset = async (
  fetcher: TimeFetcher = defaultFetcher,
): Promise<number> => {
  if (offsetSeconds !== null) return offsetSeconds;
  if (inFlight) return inFlight;
  if (Date.now() < retryAfter) return 0;

  inFlight = measureOffset(fetcher)
    .then((offset) => {
      offsetSeconds = offset;
      if (Math.abs(offset) > 30) {
        log.warn(`[steam-guard] system clock is ${offset}s off Steam's; codes were corrected`);
      } else {
        log.info(`[steam-guard] Steam time offset ${offset}s`);
      }
      return offset;
    })
    .catch((err) => {
      retryAfter = Date.now() + RETRY_COOLDOWN_MS;
      log.warn('[steam-guard] QueryTime failed, falling back to the local clock', err);
      return 0;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

/** Current time on Steam's clock, in whole seconds. */
export const getSteamTime = async (fetcher?: TimeFetcher): Promise<number> =>
  Math.floor(Date.now() / 1000) + (await getSteamTimeOffset(fetcher));

/** Test seam: drops the cached offset and any cooldown. */
export const resetSteamTimeCache = (): void => {
  offsetSeconds = null;
  inFlight = null;
  retryAfter = 0;
};

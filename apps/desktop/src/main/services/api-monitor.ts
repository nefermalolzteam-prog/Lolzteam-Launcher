import type { ApiCallRecord } from '@market-sdk';
import type { ApiMonitorSnapshot } from '@shared-types';

// The API monitor: a one-hour journal of every market call that left through
// `MarketClient`, plus whatever the server last said about the rate limit.
// Pure in-memory — a restart starts the count over, which is exactly what the
// user reads the page for: «what is happening right now, and how close is the
// ceiling».

const HOUR_MS = 60 * 60 * 1000;
/** Enough for a busy hour; the window itself does the real trimming. */
const MAX_ENTRIES = 2000;
/** The journal the page reads. */
const RECENT_SHOWN = 200;
const BUCKETS = 60;

const journal: ApiCallRecord[] = [];

/** The freshest answer that carried the trio — `null` until one does. */
let live: { limit: number; remaining: number; reset: number } | null = null;

const dropStale = (now: number): void => {
  const cutoff = now - HOUR_MS;
  let firstAlive = journal.findIndex((entry) => entry.at >= cutoff);
  if (firstAlive < 0) firstAlive = journal.length;
  if (firstAlive > 0) journal.splice(0, firstAlive);
};

/** The one entry point: called from the client hook, must stay cheap. */
export const recordApiCall = (record: ApiCallRecord): void => {
  journal.push(record);
  if (journal.length > MAX_ENTRIES) journal.splice(0, journal.length - MAX_ENTRIES);
  if (record.limit !== undefined && record.remaining !== undefined && record.reset !== undefined) {
    live = { limit: record.limit, remaining: record.remaining, reset: record.reset };
  } else if (live && record.status === 429) {
    // A refusal with no numbers still says the ceiling was hit.
    live = { ...live, remaining: 0 };
  }
};

/** Everything the page shows, computed on demand. */
export const apiMonitorSnapshot = (now = Date.now()): ApiMonitorSnapshot => {
  dropStale(now);

  const perMinute: number[] = new Array<number>(BUCKETS).fill(0);
  const current = Math.floor(now / 60_000);
  for (const entry of journal) {
    const age = current - Math.floor(entry.at / 60_000);
    if (age < 0 || age >= BUCKETS) continue;
    perMinute[BUCKETS - 1 - age] = (perMinute[BUCKETS - 1 - age] ?? 0) + 1;
  }

  return {
    recent: journal
      .slice(-RECENT_SHOWN)
      .reverse()
      .map(({ method, path, status, durationMs, at }) => ({
        at,
        method,
        path,
        status,
        durationMs,
      })),
    perMinute,
    lastHour: journal.length,
    lastMinute: perMinute[BUCKETS - 1] ?? 0,
    limit: live?.limit ?? null,
    remaining: live?.remaining ?? null,
    reset: live?.reset ?? null,
  };
};

/** Test seam: an empty journal and a forgotten ceiling. */
export const resetApiMonitorForTests = (): void => {
  journal.length = 0;
  live = null;
};

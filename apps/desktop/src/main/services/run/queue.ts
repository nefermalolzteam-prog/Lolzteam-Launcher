import type { ProxyEntry } from '@shared-types';
import log from 'electron-log/main';
import { sleep } from '../../lib/sleep';

/** Items in flight at once. */
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 5;

/** Random pause before each item starts, so the batch is not a burst. */
const DEFAULT_JITTER: JitterRange = { minMs: 250, maxMs: 1_200 };

/** Systemic failures in a row that end the run. */
const FAILURE_STREAK = 5;

/** How long the queue idles before an item. */
export interface JitterRange {
  readonly minMs: number;
  readonly maxMs: number;
}

/** Exported for the tests alone: the pause is the one part of the pacing that every suite switches off. */
export const jitterMs = (range: JitterRange): number =>
  range.minMs + Math.floor(Math.random() * Math.max(0, range.maxMs - range.minMs));

/** Brings a user-chosen concurrency into the range the queue is willing to run. */
export const clampConcurrency = (requested: number, items: number): number =>
  Math.min(
    MAX_CONCURRENCY,
    Math.max(MIN_CONCURRENCY, Math.trunc(requested) || MIN_CONCURRENCY),
    Math.max(items, MIN_CONCURRENCY),
  );

/** One item's turn: what to work on, where it sits in the list, and through what. */
export interface RunSlot<TItem> {
  readonly item: TItem;
  readonly index: number;
  readonly proxy: ProxyEntry | null;
}

export type QueueStop = 'cancelled' | 'too_many_failures';

/** The four numbers add up: `ok + failed + skipped === total`, always. */
export interface QueueOutcome {
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  /** Items the run never reached, because it was stopped or called off. */
  readonly skipped: number;
  /** Why the run ended before its list did, if it did. */
  readonly stopped: QueueStop | null;
}

export interface QueueSpec<TItem, TRow> {
  /** Only for logs: the queue never broadcasts, the caller does. */
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly items: readonly TItem[];
  readonly concurrency: number;
  /** Proxies to spread the run across, already resolved and filtered by the caller: empty = straight out. */
  readonly proxies: readonly ProxyEntry[];
  /** The proxy an individual item insists on, asked before the spread. */
  readonly pinned?: (item: TItem) => ProxyEntry | null;
  /** The work itself, and the one hard rule of this module: it must not throw. */
  readonly run: (slot: RunSlot<TItem>) => Promise<TRow>;
  /** The row an item gets when the run ended before its turn came. */
  readonly skipped: (item: TItem) => TRow;
  /** The row an item gets when `run` broke the rule above and threw. */
  readonly crashed: (item: TItem, err: unknown) => TRow;
  readonly failed: (row: TRow) => boolean;
  /** Whether a failure says something about the run rather than about the item. */
  readonly systemic: (row: TRow) => boolean;
  readonly emit: (row: TRow) => void;
  readonly jitter?: JitterRange;
}

const proxyFor = (proxies: readonly ProxyEntry[], index: number): ProxyEntry | null =>
  proxies.length > 0 ? (proxies[index % proxies.length] ?? null) : null;

/** The pin, read the way every other caller predicate in here is read. */
const pinFor = <TItem>(
  runId: string,
  pinned: ((item: TItem) => ProxyEntry | null) | undefined,
  item: TItem,
): ProxyEntry | null => {
  if (!pinned) return null;
  try {
    return pinned(item);
  } catch (err) {
    log.error(`[run/queue] ${runId} pinned() threw`, err);
    return null;
  }
};

/** Walks the list with a fixed number of workers and reports every row it settles. */
export const runQueue = async <TItem, TRow>(
  spec: QueueSpec<TItem, TRow>,
): Promise<QueueOutcome> => {
  const jitter = spec.jitter ?? DEFAULT_JITTER;
  const slots: readonly RunSlot<TItem>[] = spec.items.map((item, index) => ({
    item,
    index,
    proxy: pinFor(spec.runId, spec.pinned, item) ?? proxyFor(spec.proxies, index),
  }));

  let cursor = 0;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let streak = 0;
  let stopped: QueueStop | null = null;

  /** A predicate of the caller's, read so that a throw inside it cannot end the walk. */
  const ask = (what: string, read: () => boolean, fallback: boolean): boolean => {
    try {
      return read();
    } catch (err) {
      log.error(`[run/queue] ${spec.runId} ${what}() threw`, err);
      return fallback;
    }
  };

  /** The row's way to the panel, and often to the disk. */
  const announce = (row: TRow): void => {
    try {
      spec.emit(row);
    } catch (err) {
      log.error(`[run/queue] ${spec.runId} emit() threw`, err);
    }
  };

  /** Counts a finished row and decides whether the run has seen enough. */
  const settle = (row: TRow, crashed: boolean): void => {
    if (crashed || ask('failed', () => spec.failed(row), true)) {
      failed += 1;
      if (!crashed && ask('systemic', () => spec.systemic(row), false)) {
        streak += 1;
        if (streak >= FAILURE_STREAK && !stopped) {
          stopped = 'too_many_failures';
          log.warn(`[run/queue] ${spec.runId} stopped after ${streak} failures in a row`);
        }
      }
    } else {
      ok += 1;
      streak = 0;
    }
    announce(row);
  };

  const writeOff = (slot: RunSlot<TItem>): void => {
    // Counted first: the four numbers have to add up whether or not the caller manages to build the row that goes with this.
    skipped += 1;
    try {
      announce(spec.skipped(slot.item));
    } catch (err) {
      log.error(`[run/queue] ${spec.runId} skipped() threw`, err);
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const slot = slots[cursor];
      cursor += 1;
      if (!slot) return;

      if (spec.signal.aborted || stopped) {
        writeOff(slot);
        continue;
      }

      // The signal is passed so a cancelled run stops waiting immediately: with fifty accounts and five workers.
      await sleep(jitterMs(jitter), spec.signal);
      // The wait is long enough for the run to have been called off during it.
      if (spec.signal.aborted || stopped) {
        writeOff(slot);
        continue;
      }

      let row: TRow;
      let crashed = false;
      try {
        row = await spec.run(slot);
      } catch (err) {
        // `run` promised not to throw.
        log.error(`[run/queue] ${spec.runId} item ${slot.index} threw out of run()`, err);
        crashed = true;
        try {
          row = spec.crashed(slot.item, err);
        } catch (buildErr) {
          // The row for our own bug could not be built either.
          log.error(`[run/queue] ${spec.runId} crashed() threw`, buildErr);
          failed += 1;
          continue;
        }
      }
      settle(row, crashed);
    }
  };

  const workers = clampConcurrency(spec.concurrency, slots.length);
  // `allSettled`, not `all`: a worker that rejects anyway must not let this function return while the others are still.
  const settled = await Promise.allSettled(Array.from({ length: workers }, () => worker()));
  for (const result of settled) {
    if (result.status === 'rejected') {
      log.error(`[run/queue] ${spec.runId} worker died`, result.reason);
    }
  }

  // Cancellation wins over the streak: if the user pulled the plug.
  if (spec.signal.aborted) stopped = 'cancelled';

  return { total: slots.length, ok, failed, skipped, stopped };
};

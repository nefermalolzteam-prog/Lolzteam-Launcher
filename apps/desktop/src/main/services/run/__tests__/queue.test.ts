import type { ProxyEntry } from '@shared-types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { runQueue, clampConcurrency, jitterMs } = await import('../queue');
type QueueSpec<TItem, TRow> = import('../queue').QueueSpec<TItem, TRow>;
type RunSlot<TItem> = import('../queue').RunSlot<TItem>;

interface Row {
  readonly id: number;
  readonly state: 'done' | 'failed' | 'skipped';
  readonly systemic: boolean;
}

const NO_JITTER = { minMs: 0, maxMs: 0 };

const done = (id: number): Row => ({ id, state: 'done', systemic: false });
const fail = (id: number, systemic: boolean): Row => ({ id, state: 'failed', systemic });

const proxy = (id: string): ProxyEntry => ({ id, host: '127.0.0.1', port: 1080 });

/** A spec with everything wired to sane fakes, so each test only states the one thing it is about. */
const spec = (
  items: readonly number[],
  run: (slot: RunSlot<number>) => Promise<Row>,
  overrides: Partial<QueueSpec<number, Row>> = {},
): { spec: QueueSpec<number, Row>; rows: Row[] } => {
  const rows: Row[] = [];
  return {
    rows,
    spec: {
      runId: 'test-run',
      signal: new AbortController().signal,
      items,
      concurrency: 1,
      proxies: [],
      run,
      skipped: (id) => ({ id, state: 'skipped', systemic: false }),
      // A crash is our own bug, not the network's: the row is failed.
      crashed: (id) => fail(id, false),
      failed: (row) => row.state === 'failed',
      systemic: (row) => row.systemic,
      emit: (row) => rows.push(row),
      jitter: NO_JITTER,
      ...overrides,
    },
  };
};

describe('runQueue', () => {
  it('hands every item to run exactly once and reports one row per item', async () => {
    const seen: number[] = [];
    const { spec: s, rows } = spec([1, 2, 3, 4, 5], async (slot) => {
      seen.push(slot.item);
      return done(slot.item);
    });

    const outcome = await runQueue(s);

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(rows).toHaveLength(5);
    expect(outcome).toEqual({ total: 5, ok: 5, failed: 0, skipped: 0, stopped: null });
  });

  it('gives each slot the index of its item, with no gaps and no repeats', async () => {
    const indices: number[] = [];
    const { spec: s } = spec(
      [10, 20, 30, 40],
      async (slot) => {
        indices.push(slot.index);
        return done(slot.item);
      },
      { concurrency: 3 },
    );

    await runQueue(s);

    expect(indices.sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('keeps at most `concurrency` items in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const { spec: s } = spec(
      Array.from({ length: 12 }, (_, i) => i),
      async (slot) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return done(slot.item);
      },
      { concurrency: 3 },
    );

    await runQueue(s);

    expect(peak).toBe(3);
  });

  it('spreads the run over the proxies in a circle', async () => {
    const used: (string | null)[] = [];
    const { spec: s } = spec(
      [1, 2, 3, 4, 5],
      async (slot) => {
        used[slot.index] = slot.proxy?.id ?? null;
        return done(slot.item);
      },
      { proxies: [proxy('a'), proxy('b')] },
    );

    await runQueue(s);

    expect(used).toEqual(['a', 'b', 'a', 'b', 'a']);
  });

  it('sends everything out straight when no proxy was given', async () => {
    const used: (ProxyEntry | null)[] = [];
    const { spec: s } = spec([1, 2, 3], async (slot) => {
      used.push(slot.proxy);
      return done(slot.item);
    });

    await runQueue(s);

    expect(used).toEqual([null, null, null]);
  });

  it('stops the whole run after a streak of systemic failures', async () => {
    // Five in a row is the streak; the sixth item must never be attempted.
    const attempted: number[] = [];
    const { spec: s, rows } = spec(
      Array.from({ length: 9 }, (_, i) => i),
      async (slot) => {
        attempted.push(slot.item);
        return fail(slot.item, true);
      },
    );

    const outcome = await runQueue(s);

    expect(attempted).toEqual([0, 1, 2, 3, 4]);
    expect(outcome.stopped).toBe('too_many_failures');
    expect(outcome.failed).toBe(5);
    // The four the run never reached are counted, not left to be inferred.
    expect(outcome.skipped).toBe(4);
    expect(outcome.ok + outcome.failed + outcome.skipped).toBe(outcome.total);
    expect(rows.filter((r) => r.state === 'skipped').map((r) => r.id)).toEqual([5, 6, 7, 8]);
  });

  it('does not count failures that are the item’s own problem towards the streak', async () => {
    // A missing credential fails the row and nothing else.
    const attempted: number[] = [];
    const { spec: s } = spec(
      Array.from({ length: 8 }, (_, i) => i),
      async (slot) => {
        attempted.push(slot.item);
        return fail(slot.item, false);
      },
    );

    const outcome = await runQueue(s);

    expect(attempted).toHaveLength(8);
    expect(outcome).toEqual({ total: 8, ok: 0, failed: 8, skipped: 0, stopped: null });
  });

  it('lets one success clear the streak', async () => {
    // Four failures, an account that works, four more failures: nine items.
    const { spec: s } = spec(
      Array.from({ length: 9 }, (_, i) => i),
      async (slot) => (slot.index === 4 ? done(slot.item) : fail(slot.item, true)),
    );

    const outcome = await runQueue(s);

    expect(outcome).toEqual({ total: 9, ok: 1, failed: 8, skipped: 0, stopped: null });
  });

  it('skips the rest when the run is cancelled halfway', async () => {
    const ctl = new AbortController();
    const attempted: number[] = [];
    const { spec: s, rows } = spec(
      Array.from({ length: 8 }, (_, i) => i),
      async (slot) => {
        attempted.push(slot.item);
        if (slot.index === 2) ctl.abort();
        return done(slot.item);
      },
      { signal: ctl.signal },
    );

    const outcome = await runQueue(s);

    expect(attempted).toEqual([0, 1, 2]);
    expect(outcome.stopped).toBe('cancelled');
    expect(rows.filter((r) => r.state === 'skipped')).toHaveLength(5);
    // Every item is still accounted for: the panel shows a row for each one.
    expect(rows).toHaveLength(8);
  });

  it('reports cancellation even when the failures had already stopped the run', async () => {
    const ctl = new AbortController();
    const { spec: s } = spec(
      Array.from({ length: 9 }, (_, i) => i),
      async (slot) => {
        if (slot.index === 4) ctl.abort();
        return fail(slot.item, true);
      },
      { signal: ctl.signal },
    );

    expect((await runQueue(s)).stopped).toBe('cancelled');
  });

  it('survives a run that throws in breach of its contract', async () => {
    // The worker that caught it must keep walking the list, or one bad item silently swallows every account queued behind it.
    const attempted: number[] = [];
    const { spec: s, rows } = spec([0, 1, 2, 3], async (slot) => {
      attempted.push(slot.item);
      if (slot.index === 1) throw new Error('contract broken');
      return done(slot.item);
    });

    const outcome = await runQueue(s);

    expect(attempted).toEqual([0, 1, 2, 3]);
    expect(rows).toHaveLength(4);
    expect(outcome).toEqual({ total: 4, ok: 3, failed: 1, skipped: 0, stopped: null });
  });

  it('gives a thrown item the crashed row, never the skipped one', async () => {
    // The two are opposite news: skipped means «до него не дошли».
    const { spec: s, rows } = spec(
      [7],
      async () => {
        throw new Error('contract broken');
      },
      { crashed: (id) => ({ id, state: 'failed', systemic: false }) },
    );

    const outcome = await runQueue(s);

    expect(rows).toEqual([{ id: 7, state: 'failed', systemic: false }]);
    expect(outcome).toEqual({ total: 1, ok: 0, failed: 1, skipped: 0, stopped: null });
  });

  it('never lets a thrown run add up to a stop', async () => {
    // A bug in our own code says nothing about the network.
    const { spec: s } = spec(
      Array.from({ length: 7 }, (_, i) => i),
      async () => {
        throw new Error('always');
      },
    );

    const outcome = await runQueue(s);

    expect(outcome).toEqual({ total: 7, ok: 0, failed: 7, skipped: 0, stopped: null });
  });

  it('keeps walking when the caller’s emit throws', async () => {
    const seen: number[] = [];
    const { spec: s } = spec(
      [0, 1, 2, 3],
      async (slot) => {
        seen.push(slot.item);
        return done(slot.item);
      },
      {
        emit: (row) => {
          if (row.id === 1) throw new Error('window closed');
        },
      },
    );

    const outcome = await runQueue(s);

    expect(seen).toEqual([0, 1, 2, 3]);
    expect(outcome).toEqual({ total: 4, ok: 4, failed: 0, skipped: 0, stopped: null });
  });

  it('reads an unreadable verdict as a failure rather than losing the worker', async () => {
    const { spec: s } = spec([0, 1, 2], async (slot) => done(slot.item), {
      failed: (row) => {
        if (row.id === 1) throw new Error('row shape changed');
        return row.state === 'failed';
      },
    });

    // The middle one is counted as failed — an outcome nobody could read is not a success.
    expect(await runQueue(s)).toEqual({ total: 3, ok: 2, failed: 1, skipped: 0, stopped: null });
  });

  it('never stops a run over a systemic() that throws', async () => {
    // Our own predicate failing says nothing about the network, so it must not feed the streak — seven items.
    const attempted: number[] = [];
    const { spec: s } = spec(
      Array.from({ length: 7 }, (_, i) => i),
      async (slot) => {
        attempted.push(slot.item);
        return fail(slot.item, true);
      },
      {
        systemic: () => {
          throw new Error('unreadable');
        },
      },
    );

    const outcome = await runQueue(s);

    expect(attempted).toHaveLength(7);
    expect(outcome).toEqual({ total: 7, ok: 0, failed: 7, skipped: 0, stopped: null });
  });

  it('still counts an item whose skipped row could not be built', async () => {
    const ctl = new AbortController();
    const { spec: s, rows } = spec(
      Array.from({ length: 5 }, (_, i) => i),
      async (slot) => {
        if (slot.index === 0) ctl.abort();
        return done(slot.item);
      },
      {
        signal: ctl.signal,
        skipped: () => {
          throw new Error('cannot build');
        },
      },
    );

    const outcome = await runQueue(s);

    // No row for the four that were written off.
    expect(rows).toHaveLength(1);
    expect(outcome.skipped).toBe(4);
    expect(outcome.ok + outcome.failed + outcome.skipped).toBe(outcome.total);
  });

  it('still counts an item whose crashed row could not be built either', async () => {
    const { spec: s, rows } = spec(
      [0, 1, 2],
      async (slot) => {
        if (slot.index === 1) throw new Error('contract broken');
        return done(slot.item);
      },
      {
        crashed: () => {
          throw new Error('cannot build');
        },
      },
    );

    const outcome = await runQueue(s);

    expect(rows.map((r) => r.id)).toEqual([0, 2]);
    expect(outcome).toEqual({ total: 3, ok: 2, failed: 1, skipped: 0, stopped: null });
  });

  it('runs nothing and reports nothing for an empty list', async () => {
    const { spec: s, rows } = spec([], async (slot) => done(slot.item));

    expect(await runQueue(s)).toEqual({ total: 0, ok: 0, failed: 0, skipped: 0, stopped: null });
    expect(rows).toEqual([]);
  });
});

describe('clampConcurrency', () => {
  it('keeps a sane setting as it is', () => {
    expect(clampConcurrency(3, 50)).toBe(3);
  });

  it('refuses to open more connections than the ceiling allows', () => {
    expect(clampConcurrency(40, 50)).toBe(5);
  });

  it('falls back to one worker when the setting is missing or zeroed', () => {
    expect(clampConcurrency(0, 50)).toBe(1);
    expect(clampConcurrency(Number.NaN, 50)).toBe(1);
    expect(clampConcurrency(-4, 50)).toBe(1);
  });

  it('does not start more workers than there are items', () => {
    expect(clampConcurrency(5, 2)).toBe(2);
    expect(clampConcurrency(5, 0)).toBe(1);
  });
});

describe('jitterMs', () => {
  it('stays inside the range it was given', () => {
    const range = { minMs: 250, maxMs: 1_200 };
    const random = vi.spyOn(Math, 'random');

    random.mockReturnValue(0);
    expect(jitterMs(range)).toBe(250);
    random.mockReturnValue(0.999_999);
    expect(jitterMs(range)).toBe(1_199);

    random.mockRestore();
  });

  it('is off entirely for a zero range, which is what every suite here passes', () => {
    expect(jitterMs({ minMs: 0, maxMs: 0 })).toBe(0);
  });

  it('never counts backwards from a range whose ends are the wrong way round', () => {
    // A negative delay fires `setTimeout` on the next tick.
    expect(jitterMs({ minMs: 800, maxMs: 100 })).toBe(800);
  });

  it('leaves a real pause in place when the caller names no range at all', async () => {
    // The whole reason the function is exported.
    vi.useFakeTimers();
    try {
      const seen: number[] = [];
      const { spec: s } = spec([1], async (slot) => {
        seen.push(slot.item);
        return done(slot.item);
      });
      const { jitter: _default, ...noRange } = s;

      const run = runQueue(noRange);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([]);

      await vi.advanceTimersByTimeAsync(5_000);
      await run;
      expect(seen).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});

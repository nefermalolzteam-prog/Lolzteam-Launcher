import type { ActionEntry } from '@shared-types';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  RUN_GAP_MS,
  collapseRuns,
  countByGroup,
  countByStatus,
  dayKey,
  filterEntries,
  formatClock,
  formatDuration,
  groupsOf,
  matches,
  sectionsOf,
} from '../actionLogRules';

let seq = 0;

/** One entry, with only the fields a given test cares about spelled out. */
const entry = (over: Partial<ActionEntry> = {}): ActionEntry => ({
  id: `e${++seq}`,
  at: Date.UTC(2026, 0, 2, 12, 0, 0),
  durationMs: 100,
  action: 'account.login',
  status: 'ok',
  target: null,
  itemId: null,
  detail: null,
  ...over,
});

/** Local midnight, so the day a test means is the day `dayKey` computes. */
const local = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

describe('matches', () => {
  it('lets everything through the empty filter', () => {
    expect(matches(entry(), EMPTY_FILTER)).toBe(true);
  });

  it('filters by status', () => {
    const failed = entry({ status: 'fail' });
    expect(matches(failed, { ...EMPTY_FILTER, status: 'fail' })).toBe(true);
    expect(matches(failed, { ...EMPTY_FILTER, status: 'ok' })).toBe(false);
    expect(matches(failed, { ...EMPTY_FILTER, status: 'cancelled' })).toBe(false);
  });

  it('filters by the first segment of the action id', () => {
    const imported = entry({ action: 'local.import' });
    expect(matches(imported, { ...EMPTY_FILTER, group: 'local' })).toBe(true);
    expect(matches(imported, { ...EMPTY_FILTER, group: 'account' })).toBe(false);
  });

  it('treats an id with no dot as its own group', () => {
    expect(matches(entry({ action: 'refresh' }), { ...EMPTY_FILTER, group: 'refresh' })).toBe(true);
  });

  it('searches the action id, the target and the detail', () => {
    const one = entry({ action: 'proxy.check', target: 'Мой прокси', detail: '3/4 ok' });
    for (const query of ['proxy', 'мой', '3/4']) {
      expect(matches(one, { ...EMPTY_FILTER, query })).toBe(true);
    }
    expect(matches(one, { ...EMPTY_FILTER, query: 'steam' })).toBe(false);
  });

  it('folds case on both sides, in both alphabets', () => {
    const one = entry({ target: 'ПРОДАВЕЦ', detail: 'Rate Limited' });
    expect(matches(one, { ...EMPTY_FILTER, query: 'продавец' })).toBe(true);
    expect(matches(one, { ...EMPTY_FILTER, query: 'RATE' })).toBe(true);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(matches(entry(), { ...EMPTY_FILTER, query: '   ' })).toBe(true);
    expect(matches(entry({ action: 'mail.open' }), { ...EMPTY_FILTER, query: '  mail ' })).toBe(
      true,
    );
  });

  it('survives null target and detail', () => {
    expect(matches(entry({ target: null, detail: null }), { ...EMPTY_FILTER, query: 'x' })).toBe(
      false,
    );
  });

  it('ands its three parts together', () => {
    const one = entry({ action: 'steam.login', status: 'fail', detail: 'guard rejected' });
    expect(matches(one, { status: 'fail', group: 'steam', query: 'guard' })).toBe(true);
    expect(matches(one, { status: 'ok', group: 'steam', query: 'guard' })).toBe(false);
  });
});

describe('filterEntries', () => {
  it('keeps the original order of what survives', () => {
    const list = [
      entry({ action: 'a.one', status: 'ok' }),
      entry({ action: 'b.two', status: 'fail' }),
      entry({ action: 'a.three', status: 'fail' }),
    ];
    expect(filterEntries(list, { ...EMPTY_FILTER, status: 'fail' }).map((e) => e.action)).toEqual([
      'b.two',
      'a.three',
    ]);
  });

  it('returns everything for the empty filter', () => {
    const list = [entry(), entry(), entry()];
    expect(filterEntries(list, EMPTY_FILTER)).toHaveLength(3);
  });
});

describe('groupsOf', () => {
  it('lists each group once, in the order it first appears', () => {
    const list = [
      entry({ action: 'run.mass' }),
      entry({ action: 'account.login' }),
      entry({ action: 'run.stop' }),
      entry({ action: 'proxy.check' }),
    ];
    expect(groupsOf(list)).toEqual(['run', 'account', 'proxy']);
  });

  it('is empty for an empty list', () => {
    expect(groupsOf([])).toEqual([]);
  });
});

describe('countByStatus', () => {
  it('counts each status and the whole list', () => {
    const list = [
      entry({ status: 'ok' }),
      entry({ status: 'fail' }),
      entry({ status: 'fail' }),
      entry({ status: 'cancelled' }),
    ];
    expect(countByStatus(list)).toEqual({ all: 4, ok: 1, fail: 2, cancelled: 1 });
  });

  it('reports zeroes rather than missing keys', () => {
    expect(countByStatus([])).toEqual({ all: 0, ok: 0, fail: 0, cancelled: 0 });
  });
});

describe('countByGroup', () => {
  it('counts the entries of each group', () => {
    const list = [
      entry({ action: 'run.mass' }),
      entry({ action: 'run.stop' }),
      entry({ action: 'proxy.check' }),
    ];
    expect(countByGroup(list)).toEqual({ run: 2, proxy: 1 });
  });

  it('has no keys at all for an empty list', () => {
    expect(countByGroup([])).toEqual({});
  });
});

describe('collapseRuns', () => {
  /** A repeat of `settings.save` `gap` ms before the previous one. */
  const repeat = (at: number, over: Partial<ActionEntry> = {}): ActionEntry =>
    entry({ at, action: 'settings.save', detail: 'proxies', ...over });

  it('leaves a plain list alone, one run per entry', () => {
    const list = [entry({ action: 'a.one' }), entry({ action: 'b.two' })];
    const runs = collapseRuns(list);
    expect(runs.map((r) => r.head.action)).toEqual(['a.one', 'b.two']);
    expect(runs.every((r) => r.rest.length === 0)).toBe(true);
  });

  it('swallows identical neighbours into the first of them', () => {
    const at = local(2026, 1, 2, 13, 27);
    const runs = collapseRuns([repeat(at), repeat(at - 1000), repeat(at - 2000)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.head.at).toBe(at);
    expect(runs[0]?.rest).toHaveLength(2);
  });

  it('does not merge across an unrelated entry', () => {
    const at = local(2026, 1, 2, 13, 27);
    const runs = collapseRuns([
      repeat(at),
      entry({ at: at - 1000, action: 'run.mass' }),
      repeat(at - 2000),
    ]);
    expect(runs.map((r) => r.rest.length)).toEqual([0, 0, 0]);
  });

  it('keeps status, target and detail apart', () => {
    const at = local(2026, 1, 2, 13, 27);
    const runs = collapseRuns([
      repeat(at),
      repeat(at - 1000, { status: 'fail' }),
      repeat(at - 2000, { target: 'seller' }),
      repeat(at - 3000, { detail: 'notifications' }),
    ]);
    expect(runs).toHaveLength(4);
  });

  it('merges regardless of how long each repeat took', () => {
    const at = local(2026, 1, 2, 13, 27);
    const runs = collapseRuns([
      repeat(at, { durationMs: 2 }),
      repeat(at - 1000, { durationMs: 900 }),
    ]);
    expect(runs).toHaveLength(1);
  });

  it('ends a run when the repeats drift apart', () => {
    // The point of the gap: six writes in a second are one action recorded six times.
    const at = local(2026, 1, 2, 13, 27);
    expect(collapseRuns([repeat(at), repeat(at - RUN_GAP_MS)])).toHaveLength(1);
    expect(collapseRuns([repeat(at), repeat(at - RUN_GAP_MS - 1)])).toHaveLength(2);
  });

  it('measures the gap against the previous repeat, not the head', () => {
    // A slow drip stays one run: each step is inside the window even though the last member is far older than the head.
    const at = local(2026, 1, 2, 13, 27);
    const step = RUN_GAP_MS - 1000;
    expect(collapseRuns([repeat(at), repeat(at - step), repeat(at - 2 * step)])).toHaveLength(1);
  });

  it('is empty for an empty list', () => {
    expect(collapseRuns([])).toEqual([]);
  });
});

describe('dayKey', () => {
  it('answers in local time, not UTC', () => {
    // 00:30 local on the 2nd.
    const at = local(2026, 1, 2, 0, 30);
    expect(dayKey(at)).toBe('2026-01-02');
    expect(new Date(at).getDate()).toBe(2);
  });

  it('pads month and day', () => {
    expect(dayKey(local(2026, 3, 7))).toBe('2026-03-07');
  });

  it('rolls over at local midnight', () => {
    expect(dayKey(local(2026, 1, 1, 23, 59))).toBe('2026-01-01');
    expect(dayKey(local(2026, 1, 2, 0, 0))).toBe('2026-01-02');
  });
});

describe('sectionsOf', () => {
  it('cuts a newest-first list into days, preserving order', () => {
    const list = [
      entry({ at: local(2026, 1, 3, 18) }),
      entry({ at: local(2026, 1, 3, 9) }),
      entry({ at: local(2026, 1, 2, 22) }),
    ];
    const sections = sectionsOf(list);
    expect(sections.map((s) => s.day)).toEqual(['2026-01-03', '2026-01-02']);
    expect(sections.map((s) => s.entries.length)).toEqual([2, 1]);
  });

  it('merges only adjacent entries, so a jumbled list looks jumbled', () => {
    // Deliberate: the single pass is what makes an out-of-order store visible instead of quietly re-sorted into something.
    const list = [
      entry({ at: local(2026, 1, 3) }),
      entry({ at: local(2026, 1, 2) }),
      entry({ at: local(2026, 1, 3) }),
    ];
    expect(sectionsOf(list).map((s) => s.day)).toEqual(['2026-01-03', '2026-01-02', '2026-01-03']);
  });

  it('is empty for an empty list', () => {
    expect(sectionsOf([])).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('uses milliseconds below a second', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(1)).toBe('1 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(12.4)).toBe('12 ms');
  });

  it('uses one decimal of a second up to a minute', () => {
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(1449)).toBe('1.4 s');
    expect(formatDuration(59_000)).toBe('59.0 s');
  });

  it('uses minutes and seconds above a minute', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(3_601_000)).toBe('60m 1s');
  });

  it('never says «1m 60s»', () => {
    expect(formatDuration(119_600)).toBe('2m 0s');
  });

  it('gives up on a number that is not a duration', () => {
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatClock', () => {
  it('pads to hh:mm:ss, local', () => {
    expect(formatClock(new Date(2026, 0, 2, 9, 5, 7).getTime())).toBe('09:05:07');
    expect(formatClock(new Date(2026, 0, 2, 23, 59, 59).getTime())).toBe('23:59:59');
  });
});

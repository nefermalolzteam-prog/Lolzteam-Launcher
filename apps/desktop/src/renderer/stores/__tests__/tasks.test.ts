import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Task,
  type TaskDraft,
  orderedTasks,
  overallFraction,
  taskFraction,
  useTasks,
} from '../tasks';

const draft = (over: Partial<TaskDraft> & Pick<TaskDraft, 'id' | 'kind'>): TaskDraft => ({
  title: { key: 'x' },
  detail: null,
  done: 0,
  total: null,
  ...over,
});

const task = (over: Partial<Task> & Pick<Task, 'id'>): Task => ({
  kind: 'accounts',
  title: { key: 'x' },
  detail: null,
  done: 0,
  total: null,
  startedAt: 0,
  ...over,
});

const list = () => orderedTasks(useTasks.getState().tasks);

describe('taskFraction', () => {
  it('is null when the task cannot measure itself', () => {
    expect(taskFraction(task({ id: 'a', total: null, done: 3 }))).toBeNull();
    // A zero total is "not told yet" as much as a null one is.
    expect(taskFraction(task({ id: 'a', total: 0, done: 3 }))).toBeNull();
  });

  it('clamps to 0..1', () => {
    expect(taskFraction(task({ id: 'a', total: 4, done: 1 }))).toBe(0.25);
    expect(taskFraction(task({ id: 'a', total: 4, done: 9 }))).toBe(1);
    expect(taskFraction(task({ id: 'a', total: 4, done: -2 }))).toBe(0);
  });
});

describe('overallFraction', () => {
  it('averages the tasks that can measure themselves', () => {
    const fraction = overallFraction([
      task({ id: 'a', total: 4, done: 1 }),
      task({ id: 'b', total: 2, done: 2 }),
    ]);
    expect(fraction).toBeCloseTo(0.625);
  });

  it('ignores the ones that cannot, rather than counting them as zero', () => {
    expect(
      overallFraction([task({ id: 'a', total: 4, done: 1 }), task({ id: 'b', total: null })]),
    ).toBe(0.25);
  });

  it('does not add up counts across units', () => {
    // 1/2 pages and 1000/1000 bytes is "mostly done" only if you add a page to a byte.
    expect(
      overallFraction([
        task({ id: 'pages', total: 2, done: 1 }),
        task({ id: 'bytes', total: 1000, done: 1000 }),
      ]),
    ).toBe(0.75);
  });

  it('is null when nothing in the list can measure itself', () => {
    expect(overallFraction([task({ id: 'a' }), task({ id: 'b' })])).toBeNull();
    expect(overallFraction([])).toBeNull();
  });
});

describe('useTasks.sync', () => {
  beforeEach(() => {
    useTasks.getState().clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    useTasks.getState().clear();
  });

  it('stamps startedAt on first sight', () => {
    useTasks.getState().sync('accounts', [draft({ id: 'a', kind: 'accounts' })]);
    expect(list()[0]?.startedAt).toBe(Date.now());
  });

  it('keeps startedAt across progress updates', () => {
    const { sync } = useTasks.getState();
    sync('accounts', [draft({ id: 'a', kind: 'accounts', done: 1, total: 10 })]);
    const first = list()[0]?.startedAt;
    vi.advanceTimersByTime(5000);
    sync('accounts', [draft({ id: 'a', kind: 'accounts', done: 2, total: 10 })]);
    expect(list()[0]?.startedAt).toBe(first);
    expect(list()[0]?.done).toBe(2);
  });

  it('restarts the clock when an id comes back under a different kind', () => {
    const { sync } = useTasks.getState();
    sync('accounts', [draft({ id: 'shared', kind: 'accounts' })]);
    const first = list()[0]?.startedAt;
    vi.advanceTimersByTime(5000);
    sync('login', [draft({ id: 'shared', kind: 'login' })]);
    expect(list()[0]?.startedAt).toBe(first! + 5000);
  });

  it('replaces every task of the synced kind and leaves the others alone', () => {
    const { sync } = useTasks.getState();
    sync('accounts', [draft({ id: 'a', kind: 'accounts' }), draft({ id: 'b', kind: 'accounts' })]);
    sync('login', [draft({ id: 'login', kind: 'login' })]);
    sync('accounts', [draft({ id: 'b', kind: 'accounts' })]);
    expect(list().map((it) => it.id)).toEqual(['b', 'login']);
  });

  it('an empty sync retires the kind', () => {
    const { sync } = useTasks.getState();
    sync('accounts', [draft({ id: 'a', kind: 'accounts' })]);
    sync('accounts', []);
    expect(list()).toEqual([]);
  });

  it('keeps the same object when nothing changed', () => {
    const { sync } = useTasks.getState();
    sync('accounts', [draft({ id: 'a', kind: 'accounts', done: 1, total: 10 })]);
    const before = useTasks.getState().tasks;
    sync('accounts', [draft({ id: 'a', kind: 'accounts', done: 1, total: 10 })]);
    // Sources fire on every tick of the store they watch; an identical restate must not re-render the dock.
    expect(useTasks.getState().tasks).toBe(before);
  });

  it('notices a change confined to the detail params', () => {
    const { sync } = useTasks.getState();
    const base = { id: 'a', kind: 'accounts' } as const;
    sync('accounts', [draft({ ...base, detail: { key: 'd', params: { loaded: 1 } } })]);
    const before = useTasks.getState().tasks;
    sync('accounts', [draft({ ...base, detail: { key: 'd', params: { loaded: 2 } } })]);
    expect(useTasks.getState().tasks).not.toBe(before);
  });
});

describe('orderedTasks', () => {
  it('is oldest first, so a row never jumps as it updates', () => {
    const map = new Map<string, Task>([
      ['b', task({ id: 'b', startedAt: 200 })],
      ['a', task({ id: 'a', startedAt: 100 })],
    ]);
    expect(orderedTasks(map).map((it) => it.id)).toEqual(['a', 'b']);
  });

  it('breaks a tie by id rather than by insertion order', () => {
    const map = new Map<string, Task>([
      ['z', task({ id: 'z', startedAt: 100 })],
      ['a', task({ id: 'a', startedAt: 100 })],
    ]);
    expect(orderedTasks(map).map((it) => it.id)).toEqual(['a', 'z']);
  });
});

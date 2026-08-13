import { create } from 'zustand';

export type TaskId = string;

/** Which subsystem a task came from. */
export type TaskKind = 'accounts' | 'run' | 'login' | 'update' | 'proxy';

/** A line the dock renders, as a key plus whatever it interpolates. */
export interface TaskText {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** Where a bundled sub-job stands. */
export type TaskChildState = 'waiting' | 'running' | 'done' | 'failed';

/** One member of a bundled task, drawn as a line under its parent. */
export interface TaskChild {
  readonly id: TaskId;
  readonly title: TaskText;
  readonly detail: TaskText | null;
  /** Same contract as `Task.logo` — a URL the poster resolved, not a service id. */
  readonly logo?: string;
  readonly state: TaskChildState;
  readonly done: number;
  readonly total: number | null;
}

export interface Task {
  readonly id: TaskId;
  readonly kind: TaskKind;
  readonly title: TaskText;
  readonly detail: TaskText | null;
  /** A bundled image URL to show instead of the kind's glyph. */
  readonly logo?: string;
  /** Units finished, in whatever unit this task counts. */
  readonly done: number;
  /** Units in total, or `null` when the work has no countable end. */
  readonly total: number | null;
  /** Epoch ms, stamped by the store on first sight and kept across updates. */
  readonly startedAt: number;
  /** The pieces this task is made of, when it is a bundle. */
  readonly children?: readonly TaskChild[];
  /** Present only when the job can actually be stopped from here. */
  readonly cancel?: () => void;
}

/** A task as a source states it — the clock is the store's business. */
export type TaskDraft = Omit<Task, 'startedAt'>;

/** How far along a task is, `0..1`, or `null` while it cannot say. */
export const taskFraction = (task: Task): number | null => {
  if (task.total === null || task.total <= 0) return null;
  return Math.min(1, Math.max(0, task.done / task.total));
};

/** The dock's single number. */
export const overallFraction = (tasks: readonly Task[]): number | null => {
  const known = tasks.map(taskFraction).filter((f): f is number => f !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0) / known.length;
};

const sameText = (a: TaskText, b: TaskText): boolean => {
  if (a.key !== b.key) return false;
  const [pa, pb] = [a.params ?? {}, b.params ?? {}];
  const keys = Object.keys(pa);
  return keys.length === Object.keys(pb).length && keys.every((k) => pa[k] === pb[k]);
};

const sameOptionalText = (a: TaskText | null, b: TaskText | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && sameText(a, b));

const sameChild = (a: TaskChild, b: TaskChild): boolean =>
  a.id === b.id &&
  a.state === b.state &&
  a.done === b.done &&
  a.total === b.total &&
  a.logo === b.logo &&
  sameText(a.title, b.title) &&
  sameOptionalText(a.detail, b.detail);

const sameChildren = (
  a: readonly TaskChild[] | undefined,
  b: readonly TaskChild[] | undefined,
): boolean => {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every((child, i) => {
    const other = b[i];
    return other !== undefined && sameChild(child, other);
  });
};

const sameTask = (a: Task, b: Task): boolean =>
  a.id === b.id &&
  a.kind === b.kind &&
  a.done === b.done &&
  a.total === b.total &&
  a.logo === b.logo &&
  a.startedAt === b.startedAt &&
  a.cancel === b.cancel &&
  sameText(a.title, b.title) &&
  sameOptionalText(a.detail, b.detail) &&
  sameChildren(a.children, b.children);

const sameMap = (a: ReadonlyMap<TaskId, Task>, b: ReadonlyMap<TaskId, Task>): boolean => {
  if (a.size !== b.size) return false;
  for (const [id, task] of a) {
    const other = b.get(id);
    if (!other || !sameTask(task, other)) return false;
  }
  return true;
};

/** Replaces every task of one kind with exactly the drafts given. */
export type TaskSync = (kind: TaskKind, drafts: readonly TaskDraft[]) => void;

interface TasksState {
  tasks: ReadonlyMap<TaskId, Task>;
  sync: TaskSync;
  clear: () => void;
}

export const useTasks = create<TasksState>((set) => ({
  tasks: new Map(),
  sync: (kind, drafts) =>
    set((state) => {
      const next = new Map<TaskId, Task>();
      for (const [id, task] of state.tasks) if (task.kind !== kind) next.set(id, task);
      for (const draft of drafts) {
        const previous = state.tasks.get(draft.id);
        // A draft that changed kind is a new task; reusing the old clock would date it to whatever unrelated job happened to hold.
        const startedAt =
          previous && previous.kind === draft.kind ? previous.startedAt : Date.now();
        next.set(draft.id, { ...draft, startedAt });
      }
      // Sources fire on every tick of the store they watch, and most ticks say nothing new about the tasks.
      return sameMap(state.tasks, next) ? state : { tasks: next };
    }),
  clear: () => set({ tasks: new Map() }),
}));

/** The live list, oldest first — so a task never jumps position as it updates. */
export const orderedTasks = (tasks: ReadonlyMap<TaskId, Task>): Task[] =>
  [...tasks.values()].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));

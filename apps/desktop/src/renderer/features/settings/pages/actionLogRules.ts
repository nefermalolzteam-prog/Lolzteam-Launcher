import { type ActionEntry, type ActionStatus, actionGroup } from '@shared-types';

/** The status filter, plus the «всё» that is not a status. */
export type StatusFilter = ActionStatus | 'all';

export interface LogFilter {
  readonly status: StatusFilter;
  /** An action group (`account`, `local`, `run`…), or `all`. */
  readonly group: string;
  /** Free text, matched against the action id, the target and the detail. */
  readonly query: string;
}

export const EMPTY_FILTER: LogFilter = { status: 'all', group: 'all', query: '' };

/** The groups present in a list, in the order they first appear. */
export const groupsOf = (entries: readonly ActionEntry[]): string[] => {
  const seen = new Set<string>();
  for (const entry of entries) seen.add(actionGroup(entry.action));
  return [...seen];
};

/** How many of each status a list holds — the counts on the status chips. */
export const countByStatus = (
  entries: readonly ActionEntry[],
): Record<ActionStatus, number> & { all: number } => {
  const counts = { all: entries.length, ok: 0, fail: 0, cancelled: 0 };
  for (const entry of entries) counts[entry.status]++;
  return counts;
};

/** How many entries each group holds — the numbers in the group picker. */
export const countByGroup = (entries: readonly ActionEntry[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const group = actionGroup(entry.action);
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
};

/** Whether one entry survives the filter. */
export const matches = (entry: ActionEntry, filter: LogFilter): boolean => {
  if (filter.status !== 'all' && entry.status !== filter.status) return false;
  if (filter.group !== 'all' && actionGroup(entry.action) !== filter.group) return false;
  const query = filter.query.trim().toLocaleLowerCase();
  if (!query) return true;
  return [entry.action, entry.target, entry.detail].some((field) =>
    field?.toLocaleLowerCase().includes(query),
  );
};

export const filterEntries = (entries: readonly ActionEntry[], filter: LogFilter): ActionEntry[] =>
  entries.filter((entry) => matches(entry, filter));

/** A day's worth of entries, newest day first. */
export interface DaySection {
  /** `YYYY-MM-DD` in *local* time — the key the header is formatted from. */
  readonly day: string;
  readonly entries: readonly ActionEntry[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local calendar day an instant falls on. */
export const dayKey = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Cuts an already-ordered list into day sections. */
export const sectionsOf = (entries: readonly ActionEntry[]): DaySection[] => {
  const sections: { day: string; entries: ActionEntry[] }[] = [];
  for (const entry of entries) {
    const day = dayKey(entry.at);
    const last = sections[sections.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else sections.push({ day, entries: [entry] });
  }
  return sections;
};

/** A run of identical entries — one head and everything it swallowed. */
export interface LogRun {
  readonly head: ActionEntry;
  readonly rest: readonly ActionEntry[];
}

/** Two entries are «the same thing happening again» when everything the row would show is identical. */
const sameShape = (a: ActionEntry, b: ActionEntry): boolean =>
  a.action === b.action && a.status === b.status && a.target === b.target && a.detail === b.detail;

/** Repeats further apart than this start a new run. */
export const RUN_GAP_MS = 5 * 60_000;

/** Collapses consecutive identical entries into runs. */
export const collapseRuns = (entries: readonly ActionEntry[]): LogRun[] => {
  const runs: { head: ActionEntry; rest: ActionEntry[] }[] = [];
  let previous: ActionEntry | null = null;
  for (const entry of entries) {
    const open = runs[runs.length - 1];
    // The list is newest-first, so `previous.at` is the later of the two.
    const close = previous !== null && Math.abs(previous.at - entry.at) <= RUN_GAP_MS;
    if (open && previous && close && sameShape(previous, entry)) open.rest.push(entry);
    else runs.push({ head: entry, rest: [] });
    previous = entry;
  }
  return runs;
};

/** How long it took, in the coarsest unit that still says something. */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  // 59.6 s rounds to 60, and «1m 60s» is not a time.
  return seconds === 60 ? `${minutes + 1}m 0s` : `${minutes}m ${seconds}s`;
};

/** `14:03:57` — local, because the whole page is a local-time story. */
export const formatClock = (at: number): string => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

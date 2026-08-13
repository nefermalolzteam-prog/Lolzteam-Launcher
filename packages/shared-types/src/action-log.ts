/** How an action ended. */
export type ActionStatus = 'ok' | 'fail' | 'cancelled';

export const ACTION_STATUSES: readonly ActionStatus[] = ['ok', 'fail', 'cancelled'];

/** One finished action, as it sits in the journal. */
export interface ActionEntry {
  readonly id: string;
  /** Epoch ms when the action *started* — `at + durationMs` is when it ended. */
  readonly at: number;
  readonly durationMs: number;
  /** A dotted, stable id: `account.login`, `telegram.check`, `local.import`. */
  readonly action: string;
  readonly status: ActionStatus;
  /** What the action was about, in words — a proxy host, a folder, a nickname. */
  readonly target: string | null;
  /** The account it was about, when there was one. */
  readonly itemId: number | null;
  /** One line about the outcome — an error message, or what came back. */
  readonly detail: string | null;
}

/** An action as its caller states it: everything but the id and the clock. */
export interface ActionDraft {
  readonly action: string;
  readonly status: ActionStatus;
  readonly durationMs: number;
  readonly target?: string | null;
  readonly itemId?: number | null;
  readonly detail?: string | null;
}

/** The subsystem an action belongs to — the first segment of its id. */
export const actionGroup = (action: string): string => {
  const dot = action.indexOf('.');
  return dot === -1 ? action : action.slice(0, dot);
};

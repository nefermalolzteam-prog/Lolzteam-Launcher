import { randomUUID } from 'node:crypto';

interface ActiveRun {
  readonly runId: string;
  readonly ctl: AbortController;
}

let active: ActiveRun | null = null;

export type RunClaim =
  | { ok: true; runId: string; signal: AbortSignal }
  | { ok: false; reason: 'busy' };

/** Takes the slot, or refuses. */
export const claimRun = (): RunClaim => {
  if (active) return { ok: false, reason: 'busy' };
  const ctl = new AbortController();
  const runId = randomUUID();
  active = { runId, ctl };
  return { ok: true, runId, signal: ctl.signal };
};

/** Frees the slot, but only if the caller still owns it. */
export const releaseRun = (runId: string): void => {
  if (active?.runId === runId) active = null;
};

export const cancelRun = (runId: string): void => {
  if (active?.runId === runId) active.ctl.abort();
};

export const isRunActive = (): boolean => active !== null;

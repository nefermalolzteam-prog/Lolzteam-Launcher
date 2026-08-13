import { afterEach, describe, expect, it } from 'vitest';

const { cancelRun, claimRun, isRunActive, releaseRun } = await import('../active');

/** Ids handed out during a test, so the slot never leaks into the next one. */
const claimed: string[] = [];

const claim = (): { runId: string; signal: AbortSignal } => {
  const result = claimRun();
  if (!result.ok) throw new Error('the slot was already taken');
  claimed.push(result.runId);
  return { runId: result.runId, signal: result.signal };
};

afterEach(() => {
  for (const runId of claimed.splice(0)) releaseRun(runId);
});

describe('claimRun', () => {
  it('gives the slot to the first caller and refuses the second', () => {
    expect(isRunActive()).toBe(false);

    const first = claim();
    expect(first.signal.aborted).toBe(false);
    expect(isRunActive()).toBe(true);

    // Not a queue and not a second run: two batches leaving one address at once is the burst the pacing exists to avoid.
    expect(claimRun()).toEqual({ ok: false, reason: 'busy' });
  });

  it('hands the next run a fresh id and a signal the last one cannot have touched', () => {
    const first = claim();
    cancelRun(first.runId);
    releaseRun(first.runId);
    claimed.length = 0;

    const second = claim();
    expect(second.runId).not.toBe(first.runId);
    // The cancelled signal must not be the one the new run threads through its work.
    expect(second.signal.aborted).toBe(false);
    expect(first.signal.aborted).toBe(true);
  });
});

describe('releaseRun', () => {
  it('frees the slot for its owner', () => {
    const run = claim();
    releaseRun(run.runId);
    claimed.length = 0;

    expect(isRunActive()).toBe(false);
    // And the next run really can start: a slot that was freed in name only would leave the panel refusing every run until.
    expect(claim().runId).not.toBe(run.runId);
  });

  it('ignores an id that no longer owns the slot', () => {
    const run = claim();

    // The finally-block of a run that ended a minute ago.
    releaseRun('a-run-that-already-finished');

    expect(isRunActive()).toBe(true);
    expect(claimRun()).toEqual({ ok: false, reason: 'busy' });
    expect(run.signal.aborted).toBe(false);
  });
});

describe('cancelRun', () => {
  it('aborts the run that holds the slot', () => {
    const run = claim();

    cancelRun(run.runId);

    expect(run.signal.aborted).toBe(true);
    // Cancelling does not free the slot: the run is still winding down, and the release belongs to whoever owns the loop.
    expect(isRunActive()).toBe(true);
  });

  it('cannot abort a run it does not own', () => {
    const run = claim();

    cancelRun('some-other-run');

    expect(run.signal.aborted).toBe(false);
  });

  it('does nothing at all when no run is going', () => {
    expect(() => cancelRun('anything')).not.toThrow();
    expect(isRunActive()).toBe(false);
  });
});

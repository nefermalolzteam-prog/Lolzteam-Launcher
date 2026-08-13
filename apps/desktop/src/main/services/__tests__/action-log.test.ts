import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionEntry } from '@shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'lzt-action-log-'));

// The journal writes one file under `userData` and pushes each entry at whatever windows are open.
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  appendCapped,
  classifyError,
  clearActions,
  flushActions,
  listActions,
  logAction,
  outcomeOf,
  recordAction,
} = await import('../action-log');

const entry = (over: Partial<ActionEntry> = {}): ActionEntry => ({
  id: 'e',
  at: 0,
  durationMs: 0,
  action: 'account.login',
  status: 'ok',
  target: null,
  itemId: null,
  detail: null,
  ...over,
});

/** `recordAction` is fire-and-forget by design, so a test has to wait for the write it does not return. */
const settle = async (count: number): Promise<ActionEntry[]> => {
  for (let i = 0; i < 200; i++) {
    const entries = await listActions();
    if (entries.length >= count) return entries;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return listActions();
};

/** The one entry a test expects, or a failure that says the journal stayed empty. */
const newest = async (): Promise<ActionEntry> => {
  const [first] = await settle(1);
  if (!first) throw new Error('nothing was written to the journal');
  return first;
};

afterEach(async () => {
  await clearActions();
});

describe('appendCapped', () => {
  it('puts the newest first', () => {
    const older = entry({ id: 'older' });
    const newer = entry({ id: 'newer' });
    expect(appendCapped([older], newer).map((e) => e.id)).toEqual(['newer', 'older']);
  });

  it('evicts the oldest once the cap is reached', () => {
    const existing = Array.from({ length: 5 }, (_, i) => entry({ id: `e${i}` }));
    const result = appendCapped(existing, entry({ id: 'fresh' }), 3);
    expect(result.map((e) => e.id)).toEqual(['fresh', 'e0', 'e1']);
  });

  it('does not touch the array it was given', () => {
    const existing = [entry({ id: 'a' })];
    appendCapped(existing, entry({ id: 'b' }), 1);
    expect(existing.map((e) => e.id)).toEqual(['a']);
  });
});

describe('outcomeOf', () => {
  it('reads `{ ok: false, message }` as a failure with its message', () => {
    expect(outcomeOf({ ok: false, message: 'нет ответа' })).toEqual({
      status: 'fail',
      detail: 'нет ответа',
    });
  });

  it('falls back to `reason` when there is no message', () => {
    expect(outcomeOf({ ok: false, reason: 'guard_required' })).toEqual({
      status: 'fail',
      detail: 'guard_required',
    });
  });

  it('records a failure with nothing to say as a failure all the same', () => {
    expect(outcomeOf({ ok: false })).toEqual({ status: 'fail', detail: null });
  });

  it('counts anything else as success', () => {
    for (const result of [{ ok: true }, undefined, null, 'done', 42, [1, 2, 3], {}]) {
      expect(outcomeOf(result).status).toBe('ok');
    }
  });

  it('does not mistake a falsy-but-not-false `ok` for a failure', () => {
    // A handler answering `{ ok: 0 }` is not a shape the app produces, and guessing at it would turn a working call red.
    expect(outcomeOf({ ok: 0 }).status).toBe('ok');
  });
});

describe('classifyError', () => {
  it('calls an aborted promise cancelled, not failed', () => {
    const err = new Error('the operation was aborted');
    err.name = 'AbortError';
    expect(classifyError(err).status).toBe('cancelled');
  });

  it('catches the hand-rolled cancellations too', () => {
    expect(classifyError(new Error('cancelled by user')).status).toBe('cancelled');
    expect(classifyError(new Error('Aborted')).status).toBe('cancelled');
  });

  it('leaves everything else a failure', () => {
    expect(classifyError(new Error('429 too many requests')).status).toBe('fail');
    expect(classifyError('boom')).toEqual({ status: 'fail', detail: 'boom' });
  });

  it('collapses whitespace in the message it keeps', () => {
    expect(classifyError(new Error('  two   lines\nhere  ')).detail).toBe('two lines here');
  });

  /** The journal is written to disk and pushed to every open window. */
  it('strips the credentials out of a URL before writing it down', () => {
    const detail = classifyError(
      new Error('connect ECONNREFUSED http://bob:s3cret@10.0.0.1:8080/'),
    ).detail;
    expect(detail).toBe('connect ECONNREFUSED http://***@10.0.0.1:8080/');
    expect(detail).not.toContain('s3cret');
    expect(detail).not.toContain('bob');
  });

  it('leaves an ordinary URL and an ordinary colon alone', () => {
    expect(classifyError(new Error('GET https://api.lzt.market/1234 failed: 429')).detail).toBe(
      'GET https://api.lzt.market/1234 failed: 429',
    );
    expect(classifyError(new Error('host:port 10.0.0.1:8080 refused')).detail).toBe(
      'host:port 10.0.0.1:8080 refused',
    );
  });

  it('redacts a failed result’s message too, not only a thrown one', () => {
    expect(outcomeOf({ ok: false, message: 'socks5://u:p@host:1080 unreachable' }).detail).toBe(
      'socks5://***@host:1080 unreachable',
    );
  });
});

describe('recordAction', () => {
  it('writes an entry down and gives it a start time behind the duration', async () => {
    const before = Date.now();
    recordAction({ action: 'proxy.check', status: 'ok', durationMs: 1500, detail: '4/4 ok' });
    const written = await newest();
    expect(written.action).toBe('proxy.check');
    expect(written.durationMs).toBe(1500);
    expect(written.at).toBeLessThanOrEqual(before);
    expect(written.at + written.durationMs).toBeGreaterThanOrEqual(before);
  });

  it('drops a malformed draft instead of writing a broken line', async () => {
    recordAction({ action: '', status: 'ok', durationMs: 0 });
    recordAction({ action: 'x.y', status: 'weird' as never, durationMs: 0 });
    recordAction({ action: 'kept', status: 'ok', durationMs: 0 });
    const entries = await settle(1);
    expect(entries.map((e) => e.action)).toEqual(['kept']);
  });

  it('normalises the fields a caller may get wrong', async () => {
    recordAction({
      action: 'local.import',
      status: 'ok',
      durationMs: Number.NaN,
      target: '   ',
      itemId: 0,
    });
    const written = await newest();
    expect(written.durationMs).toBe(0);
    expect(written.target).toBeNull();
    // `0` is not an item; an id of zero would render as «#0» and link nowhere.
    expect(written.itemId).toBeNull();
  });

  it('survives a restart', async () => {
    recordAction({ action: 'account.login', status: 'ok', durationMs: 10 });
    await settle(1);
    await flushActions();
    const onDisk = JSON.parse(readFileSync(join(userData, 'action-log.json'), 'utf8')) as {
      version: number;
      entries: ActionEntry[];
    };
    expect(onDisk.version).toBe(1);
    expect(onDisk.entries.map((e) => e.action)).toEqual(['account.login']);
  });
});

describe('logAction', () => {
  it('passes the result through and times the work', async () => {
    const result = await logAction('run.mass', {}, async () => ({ ok: true, done: 3 }));
    expect(result).toEqual({ ok: true, done: 3 });
    const written = await newest();
    expect(written.status).toBe('ok');
    expect(written.action).toBe('run.mass');
  });

  it('describes a success through `detail` when the work has nothing to say', async () => {
    await logAction('update.check', { detail: (r: string) => `found ${r}` }, async () => '0.7.2');
    const written = await newest();
    expect(written.detail).toBe('found 0.7.2');
  });

  it('prefers what a failed result says over the caller’s description', async () => {
    await logAction('steam.login', { detail: () => 'should not win' }, async () => ({
      ok: false,
      message: 'guard rejected',
    }));
    const written = await newest();
    expect(written.status).toBe('fail');
    expect(written.detail).toBe('guard rejected');
  });

  it('re-throws, so the caller cannot tell it is being watched', async () => {
    await expect(
      logAction('mail.open', { target: 'inbox' }, async () => {
        throw new Error('imap down');
      }),
    ).rejects.toThrow('imap down');
    const written = await newest();
    expect(written).toMatchObject({ status: 'fail', detail: 'imap down', target: 'inbox' });
  });
});

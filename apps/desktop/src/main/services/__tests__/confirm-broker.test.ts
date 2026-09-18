import { IPC_CHANNELS } from '@shared-ipc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake window that records what the broker broadcasts to the renderer.
const sent: Array<{ channel: string; payload: unknown }> = [];
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
  },
};

// Capture the handler `registerConfirmIpc` installs so a test can play the
// renderer and "answer" the prompt.
let answerHandler: ((e: unknown, payload: unknown) => void) | undefined;

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [fakeWindow] },
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, payload: unknown) => void) => {
      if (channel === IPC_CHANNELS.ACCOUNT_CONFIRM_ANSWER) answerHandler = fn;
    },
  },
}));

const infoLog = vi.fn();
vi.mock('electron-log/main', () => ({
  default: { info: (m: string) => infoLog(m), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { askAccountConfirm, registerConfirmIpc } from '../confirm-broker';

const answer = (itemId: number, accept: boolean): void =>
  answerHandler?.(null, { itemId, kind: 'mafile-download', accept });

beforeEach(() => {
  sent.length = 0;
  infoLog.mockClear();
  registerConfirmIpc();
});

afterEach(() => vi.useRealTimers());

describe('askAccountConfirm', () => {
  it('resolves true when the user accepts, and asks the renderer exactly once', async () => {
    const p = askAccountConfirm(7, 'mafile-download');
    expect(sent).toEqual([
      {
        channel: IPC_CHANNELS.ACCOUNT_CONFIRM_REQUEST,
        payload: { itemId: 7, kind: 'mafile-download' },
      },
    ]);
    answer(7, true);
    await expect(p).resolves.toBe(true);
  });

  it('resolves false when the user declines', async () => {
    const p = askAccountConfirm(7, 'mafile-download');
    answer(7, false);
    await expect(p).resolves.toBe(false);
  });

  it('does not log the abandoned-abort line on a normal answer', async () => {
    const p = askAccountConfirm(7, 'mafile-download');
    answer(7, true);
    await p;
    expect(infoLog).not.toHaveBeenCalledWith(expect.stringMatching(/abandoned/));
  });

  it('detaches the abort listener once answered — a later abort is a no-op', async () => {
    const ctl = new AbortController();
    const p = askAccountConfirm(7, 'mafile-download', ctl.signal);
    answer(7, true);
    await expect(p).resolves.toBe(true);
    // The wait is over; aborting the login afterwards must not run the handler.
    ctl.abort();
    expect(infoLog).not.toHaveBeenCalledWith(expect.stringMatching(/abandoned/));
  });

  it('resolves false and declines the moment its signal aborts', async () => {
    const ctl = new AbortController();
    const p = askAccountConfirm(7, 'mafile-download', ctl.signal);
    ctl.abort();
    await expect(p).resolves.toBe(false);
  });

  it('declines at once, without asking, when the signal is already aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const p = askAccountConfirm(7, 'mafile-download', ctl.signal);
    expect(sent).toHaveLength(0);
    await expect(p).resolves.toBe(false);
  });

  it('resolves false on timeout', async () => {
    vi.useFakeTimers();
    const p = askAccountConfirm(7, 'mafile-download');
    vi.advanceTimersByTime(3 * 60_000 + 1);
    await expect(p).resolves.toBe(false);
  });

  it('ignores a malformed answer payload', async () => {
    const p = askAccountConfirm(7, 'mafile-download');
    answerHandler?.(null, { itemId: 'nope', accept: true });
    answer(7, true);
    await expect(p).resolves.toBe(true);
  });
});

import { type AccountConfirmKind, IPC_CHANNELS } from '@shared-ipc';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';

// A destructive step (downloading a Steam maFile cancels the item's active
// guarantee on the market's side) runs only after the user said yes. The
// renderer shows the prompt; this broker pairs the question with the answer,
// and never waits longer than the caller's own deadline.

/** Nothing sane waits on a person forever. */
const ANSWER_TIMEOUT_MS = 3 * 60_000;

interface Pending {
  resolve: (accept: boolean) => void;
  timer: NodeJS.Timeout;
  /** Detaches the abort listener — cleanup, whatever ends the wait. */
  detachAbort: () => void;
}

const pending = new Map<string, Pending>();

const keyOf = (itemId: number, kind: AccountConfirmKind): string => `${itemId}:${kind}`;

const settle = (key: string, accept: boolean): void => {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  clearTimeout(entry.timer);
  entry.detachAbort();
  entry.resolve(accept);
};

/** Asks the user about `kind` for `itemId`; resolves `false` on decline, abort or timeout. */
export const askAccountConfirm = (
  itemId: number,
  kind: AccountConfirmKind,
  signal?: AbortSignal | null,
): Promise<boolean> => {
  const key = keyOf(itemId, kind);
  // A second identical question merges into the first — there is one dialog on screen either way.
  return new Promise<boolean>((resolve) => {
    // The action was abandoned before we could even ask: don't put a prompt on
    // screen that would answer into the void — decline at once.
    if (signal?.aborted) {
      log.info(`[confirm] ${kind} for #${itemId} was already abandoned; not asking`);
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      log.warn(`[confirm] ${kind} for #${itemId} timed out without an answer`);
      settle(key, false);
    }, ANSWER_TIMEOUT_MS);

    // The handler declines on abort; `detachAbort` only removes it — the two
    // were conflated before, so a normal answer logged a bogus "died" line and
    // left this listener attached to the signal for the rest of the login.
    const onAbort = (): void => {
      log.info(`[confirm] ${kind} for #${itemId} was abandoned with its action`);
      settle(key, false);
    };
    signal?.addEventListener('abort', onAbort);
    const detachAbort = (): void => signal?.removeEventListener('abort', onAbort);

    pending.set(key, { resolve, timer, detachAbort });

    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.ACCOUNT_CONFIRM_REQUEST, { itemId, kind });
      }
    }
  });
};

export const registerConfirmIpc = (): void => {
  // `handle`, not `on`: the renderer answers through `invoke`, and an
  // `invoke` into an `on`-listener never arrives — the asker would sit out
  // its whole timeout while the user stares at a spinner.
  ipcMain.handle(
    IPC_CHANNELS.ACCOUNT_CONFIRM_ANSWER,
    (_e, payload: { itemId?: number; kind?: AccountConfirmKind; accept?: boolean }) => {
      if (typeof payload?.itemId !== 'number' || typeof payload?.kind !== 'string') return;
      settle(keyOf(payload.itemId, payload.kind), payload.accept === true);
    },
  );
};

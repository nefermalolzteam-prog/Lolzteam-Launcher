import type { ActionStatus } from '@shared-types';
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { classifyError, outcomeOf, recordAction } from '../services/action-log';

export interface ActionSpec<P, R> {
  /** Dotted id — also the i18n key `settings.actionLog.actions.<action>`. */
  readonly action: string;
  /** What it was about, in words: a host, a folder, a nickname. */
  readonly target?: (payload: P) => string | null;
  /** The account it was about, so the viewer can name it as the list names it. */
  readonly itemId?: (payload: P) => number | null;
  /** One line about a *successful* result — «12 аккаунтов», «203 мс». */
  readonly detail?: (result: R, payload: P) => string | null;
  /** The verdict, when the result knows better than the shape of it does. */
  readonly status?: (result: R, payload: P) => ActionStatus | null;
}

/** The handler comes first and the journal entry second, and that order is load bearing rather than a matter of taste. */
export const handleAction = <P, R>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, payload: P) => R | Promise<R>,
  spec: ActionSpec<P, Awaited<R>>,
): void => {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: P) => {
    const started = Date.now();
    // Read before the work rather than after: a handler is free to mutate what it was handed.
    const target = spec.target?.(payload) ?? null;
    const itemId = spec.itemId?.(payload) ?? null;
    try {
      const result = (await listener(event, payload)) as Awaited<R>;
      const outcome = outcomeOf(result);
      recordAction({
        action: spec.action,
        status: spec.status?.(result, payload) ?? outcome.status,
        durationMs: Date.now() - started,
        target,
        itemId,
        detail: outcome.detail ?? spec.detail?.(result, payload) ?? null,
      });
      return result;
    } catch (err) {
      const outcome = classifyError(err);
      recordAction({
        action: spec.action,
        status: outcome.status,
        durationMs: Date.now() - started,
        target,
        itemId,
        detail: outcome.detail,
      });
      // Rethrown unchanged: the renderer's `invoke` must reject exactly as it did before this wrapper existed.
      throw err;
    }
  });
};

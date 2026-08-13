import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared-ipc';
import type { ActionDraft, ActionEntry, ActionStatus } from '@shared-types';
import { BrowserWindow, app } from 'electron';
import log from 'electron-log/main';
import { redactSecrets } from '../lib/redact';

const FILE_NAME = 'action-log.json';

/** Bumped when `ActionEntry` changes shape; an older file is dropped, not migrated. */
const VERSION = 1;

/** How many actions the journal remembers. */
const MAX_ENTRIES = 2000;

/** Long enough for a real error message, short enough that nothing can flood the file. */
const MAX_TEXT = 300;

/** Writes are coalesced: a mass check finishes an account every second or two. */
const FLUSH_MS = 1200;

interface Payload {
  version: number;
  entries: ActionEntry[];
}

const logFile = () => join(app.getPath('userData'), FILE_NAME);

/** The journal is on disk and on screen, so what goes in is redacted first. */
const clip = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = redactSecrets(value.trim().replace(/\s+/g, ' '));
  if (text === '') return null;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
};

const isStatus = (value: unknown): value is ActionStatus =>
  value === 'ok' || value === 'fail' || value === 'cancelled';

/** Newest first, oldest evicted. */
export const appendCapped = (
  entries: readonly ActionEntry[],
  entry: ActionEntry,
  max = MAX_ENTRIES,
): ActionEntry[] => [entry, ...entries].slice(0, max);

/** What an action's return value says about how it went. */
export const outcomeOf = (result: unknown): { status: ActionStatus; detail: string | null } => {
  if (result !== null && typeof result === 'object' && 'ok' in result) {
    const bag = result as { ok?: unknown; message?: unknown; reason?: unknown };
    if (bag.ok === false) {
      return { status: 'fail', detail: clip(bag.message) ?? clip(bag.reason) };
    }
  }
  return { status: 'ok', detail: null };
};

/** Which of the three endings an exception is. */
export const classifyError = (err: unknown): { status: ActionStatus; detail: string | null } => {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  const aborted = name === 'AbortError' || /\b(abort|cancel)/i.test(message);
  return { status: aborted ? 'cancelled' : 'fail', detail: clip(message) };
};

class ActionLogStore {
  private entries: ActionEntry[] | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  private async loaded(): Promise<ActionEntry[]> {
    if (this.entries !== null) return this.entries;
    try {
      const parsed = JSON.parse(await fs.readFile(logFile(), 'utf8')) as Partial<Payload>;
      this.entries =
        parsed.version === VERSION && Array.isArray(parsed.entries)
          ? (parsed.entries as ActionEntry[]).slice(0, MAX_ENTRIES)
          : [];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Unlike the settings, an unreadable journal is not overwritten reluctantly — it *is* a journal.
        log.warn('[action-log] unreadable, starting a new one', err);
      }
      this.entries = [];
    }
    return this.entries;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_MS);
  }

  /** Serialised on purpose: two overlapping writes of the same file interleave. */
  async flush(): Promise<void> {
    const entries = this.entries;
    if (entries === null) return;
    this.writing = this.writing.then(async () => {
      const payload: Payload = { version: VERSION, entries };
      try {
        await fs.writeFile(logFile(), JSON.stringify(payload), { mode: 0o600 });
      } catch (err) {
        log.warn('[action-log] failed to write', err);
      }
    });
    return this.writing;
  }

  async record(draft: ActionDraft): Promise<ActionEntry | null> {
    const action = clip(draft?.action);
    if (action === null || !isStatus(draft?.status)) {
      log.warn('[action-log] ignoring a malformed entry', draft);
      return null;
    }
    const durationMs = Number(draft.durationMs);
    const ms = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0;
    const itemId = Number(draft.itemId);
    const entry: ActionEntry = {
      id: crypto.randomUUID(),
      // The caller reports a length, not a moment: it is the one of the two that it actually measured.
      at: Date.now() - ms,
      durationMs: ms,
      action,
      status: draft.status,
      target: clip(draft.target),
      itemId: Number.isInteger(itemId) && itemId !== 0 ? itemId : null,
      detail: clip(draft.detail),
    };
    const entries = await this.loaded();
    this.entries = appendCapped(entries, entry);
    this.schedule();
    return entry;
  }

  list(): Promise<ActionEntry[]> {
    return this.loaded().then((entries) => [...entries]);
  }

  async clear(): Promise<void> {
    this.entries = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      await fs.unlink(logFile());
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[action-log] failed to remove', err);
      }
    }
  }
}

const store = new ActionLogStore();

export const listActions = (): Promise<ActionEntry[]> => store.list();
export const clearActions = (): Promise<void> => store.clear();
export const flushActions = (): Promise<void> => store.flush();

/** Writes one finished action down and tells any open window about it. */
export const recordAction = (draft: ActionDraft): void => {
  void store
    .record(draft)
    .then((entry) => {
      if (entry === null) return;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.ACTION_LOG_ENTRY, entry);
      }
    })
    .catch((err) => {
      log.warn('[action-log] failed to record', err);
    });
};

/** Times a piece of main-side work and writes down how it went. */
export const logAction = async <T>(
  action: string,
  meta: Omit<ActionDraft, 'action' | 'status' | 'durationMs' | 'detail'> & {
    detail?: (result: T) => string | null;
  },
  run: () => Promise<T>,
): Promise<T> => {
  const started = Date.now();
  const { detail: describe, ...rest } = meta;
  try {
    const result = await run();
    const outcome = outcomeOf(result);
    recordAction({
      ...rest,
      action,
      status: outcome.status,
      durationMs: Date.now() - started,
      detail: outcome.detail ?? describe?.(result) ?? null,
    });
    return result;
  } catch (err) {
    const outcome = classifyError(err);
    recordAction({
      ...rest,
      action,
      status: outcome.status,
      durationMs: Date.now() - started,
      detail: outcome.detail,
    });
    throw err;
  }
};

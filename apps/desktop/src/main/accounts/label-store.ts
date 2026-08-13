import { join } from 'node:path';
import type { LocalLabel, LocalLabelResult } from '@shared-types';
import log from 'electron-log/main';
import { onDbRelocated } from './db-events';
import { LABELS_FILE, dbRoot, readJsonFile, writeJsonFile } from './db-paths';

const MAX_TITLE = 24;
const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** What a label gets when the renderer sends nothing usable. */
const DEFAULT_COLOUR = '#3a3a3a';

const asColour = (v: unknown): string => {
  if (typeof v !== 'string') return DEFAULT_COLOUR;
  const raw = v.trim();
  if (HEX6.test(raw)) return raw.toLowerCase();
  // `#abc` is what a colour input hands back on some platforms.
  if (HEX3.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return DEFAULT_COLOUR;
};

const cleanTitle = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

const asId = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v < 0 ? v : null;

/** `lastId` before anything has been handed out is 0, which is not an id. */
const asCounter = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v <= 0 ? v : null;

interface LabelFile {
  labels: LocalLabel[];
  /** Lowest id ever handed out; the next one is `lastId - 1`. */
  lastId: number;
}

interface ParsedLabels {
  readonly file: LabelFile;
  /** Whether this was a label file as this build spells one. */
  readonly understood: boolean;
}

const parse = (data: unknown): ParsedLabels => {
  const labels: LocalLabel[] = [];
  const foreign: ParsedLabels = { file: { labels, lastId: 0 }, understood: false };

  if (!data || typeof data !== 'object') return foreign;
  const root = data as { labels?: unknown; lastId?: unknown };
  if (!Array.isArray(root.labels)) return foreign;

  let understood = true;
  for (const item of root.labels) {
    if (!item || typeof item !== 'object') {
      understood = false;
      continue;
    }
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'number') {
      understood = false;
      continue;
    }
    const id = asId(r.id);
    const title = typeof r.title === 'string' ? cleanTitle(r.title) : '';
    if (id === null || !title || labels.some((l) => l.id === id)) continue;
    labels.push({ id, title, bc: asColour(r.bc) });
  }

  // A hand-written file may have no counter; the lowest id in it is the safest guess.
  const stored = asCounter(root.lastId);
  if (root.lastId !== undefined && stored === null) understood = false;
  const lastId = Math.min(stored ?? 0, ...labels.map((l) => l.id), 0);
  return { file: { labels, lastId }, understood };
};

class LabelStore {
  private file: LabelFile | null = null;
  /** The root the cache was read from; a move makes it worthless. */
  private root: string | null = null;
  /** The file is there but unreadable — every write is refused until it is not. */
  private broken = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    onDbRelocated(() => this.reset());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<LabelFile> {
    const root = await dbRoot();
    if (this.file && this.root === root) return this.file;

    this.root = root;
    this.broken = false;
    try {
      const parsed = parse(await readJsonFile(join(root, LABELS_FILE)));
      this.file = parsed.file;
      if (!parsed.understood) {
        // Readable, valid JSON, and not a label file as far as this build can tell.
        log.error(
          `[local-labels] ${LABELS_FILE} is not in a shape this build understands; labels are read-only until it is fixed or removed`,
        );
        this.broken = true;
      }
    } catch (err) {
      this.file = { labels: [], lastId: 0 };
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('[local-labels] could not read the label file', err);
        this.broken = true;
      }
    }
    return this.file;
  }

  private async persist(file: LabelFile): Promise<void> {
    await writeJsonFile(join(await dbRoot(), LABELS_FILE), file);
    this.file = file;
  }

  list(): Promise<LocalLabel[]> {
    return this.enqueue(async () => [...(await this.load()).labels]);
  }

  /** Adds a label, or renames and recolours one that exists. */
  save(input: { id: number | null; title: string; bc: string }): Promise<LocalLabelResult> {
    return this.enqueue(async () => {
      const { labels, lastId } = await this.load();
      if (this.broken) return { ok: false, message: 'store_unreadable' };

      const title = cleanTitle(input.title);
      if (!title) return { ok: false, message: 'empty_title' };
      const bc = asColour(input.bc);

      let next: LabelFile;
      if (input.id === null) {
        const id = lastId - 1;
        next = { labels: [...labels, { id, title, bc }], lastId: id };
      } else {
        if (!labels.some((l) => l.id === input.id)) return { ok: false, message: 'not_found' };
        next = {
          labels: labels.map((l) => (l.id === input.id ? { ...l, title, bc } : l)),
          lastId,
        };
      }

      try {
        await this.persist(next);
      } catch (err) {
        log.error('[local-labels] failed to write the label file', err);
        return { ok: false, message: 'write_failed' };
      }
      return { ok: true, labels: [...next.labels] };
    });
  }

  /** Drops a definition. */
  remove(id: number): Promise<LocalLabelResult> {
    return this.enqueue(async () => {
      const { labels, lastId } = await this.load();
      if (this.broken) return { ok: false, message: 'store_unreadable' };
      if (!labels.some((l) => l.id === id)) return { ok: false, message: 'not_found' };

      const next: LabelFile = { labels: labels.filter((l) => l.id !== id), lastId };
      try {
        await this.persist(next);
      } catch (err) {
        log.error('[local-labels] failed to write the label file', err);
        return { ok: false, message: 'write_failed' };
      }
      return { ok: true, labels: [...next.labels] };
    });
  }

  reset(): void {
    this.file = null;
    this.root = null;
    this.broken = false;
    this.queue = Promise.resolve();
  }
}

const store = new LabelStore();

export const listLocalLabels = (): Promise<LocalLabel[]> => store.list();
export const saveLocalLabel = (input: {
  id: number | null;
  title: string;
  bc: string;
}): Promise<LocalLabelResult> => store.save(input);
export const deleteLocalLabel = (id: number): Promise<LocalLabelResult> => store.remove(id);
export const resetLocalLabelsForTests = (): void => store.reset();

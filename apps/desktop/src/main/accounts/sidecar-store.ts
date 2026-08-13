import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { LocalServiceId } from '@shared-types';
import log from 'electron-log/main';
import { onDbRelocated } from './db-events';
import {
  MARKET_DIR,
  dbRoot,
  dirStamp,
  marketSidecarDir,
  readJsonFile,
  subDirs,
  writeJsonFile,
} from './db-paths';
import { localAccountFolder, localAccountFolders } from './local-store';

export interface SidecarSpec<T> {
  /** Which service's folders to look in. */
  readonly service: LocalServiceId;
  /** File name inside the account folder. */
  readonly file: string;
  /** Log prefix, e.g. `[steam-guard]`. */
  readonly tag: string;
  /** Returns null for a record that is missing something it cannot work without. */
  readonly parse: (raw: unknown, accountId: number) => T | null;
  /** Fills in what only the folder can answer — whether the avatar beside the record is actually there. */
  readonly hydrate?: (value: T, dir: string) => Promise<T>;
}

interface Entry<T> {
  value: T;
  dir: string;
}

export class SidecarStore<T> {
  private entries: Map<number, Entry<T>> | null = null;
  /** Accounts whose file is there but could not be read or understood, and the folder it sits in. */
  private broken = new Map<number, string>();
  /** Generation of the account scan these folders came from. */
  private generation = -1;
  /** mtime of `_market`, which the account scan knows nothing about. */
  private marketStamp = -1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly spec: SidecarSpec<T>) {
    onDbRelocated(() => this.resetCache());
  }

  private enqueue<TResult>(fn: () => Promise<TResult>): Promise<TResult> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async marketRoot(): Promise<string> {
    return join(await dbRoot(), this.spec.service, MARKET_DIR);
  }

  private async load(): Promise<Map<number, Entry<T>>> {
    const { generation, folders } = await localAccountFolders();
    const marketStamp = await dirStamp(await this.marketRoot()).catch(() => -1);
    if (this.entries && generation === this.generation && marketStamp === this.marketStamp) {
      return this.entries;
    }

    const entries = new Map<number, Entry<T>>();
    const broken = new Map<number, string>();
    const places: { id: number; dir: string }[] = folders
      .filter((f) => f.service === this.spec.service)
      .map((f) => ({ id: f.id, dir: f.dir }));

    const marketRoot = await this.marketRoot();
    for (const name of await subDirs(marketRoot).catch(() => [])) {
      const id = Number(name);
      // A folder whose name is not a market item id was not put there by us.
      if (!Number.isInteger(id) || id <= 0) continue;
      places.push({ id, dir: join(marketRoot, name) });
    }

    for (const { id, dir } of places) {
      let raw: unknown;
      try {
        raw = await readJsonFile(join(dir, this.spec.file));
      } catch (err) {
        // Not having one is the normal case; anything else is worth a line — and, since the file is evidently there.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          const code = (err as NodeJS.ErrnoException).code ?? 'unreadable content';
          log.error(`${this.spec.tag} skipping ${dir}: ${code}`);
          broken.set(id, dir);
        }
        continue;
      }
      const value = this.spec.parse(raw, id);
      if (!value) {
        log.error(`${this.spec.tag} skipping ${dir}: incomplete record`);
        broken.set(id, dir);
        continue;
      }
      entries.set(id, { value: (await this.spec.hydrate?.(value, dir)) ?? value, dir });
    }

    this.entries = entries;
    this.broken = broken;
    this.generation = generation;
    this.marketStamp = marketStamp;
    return entries;
  }

  /** Where this account's files go — its own folder, or the market shelf. */
  async dirFor(accountId: number): Promise<string | null> {
    const own = await localAccountFolder(accountId);
    if (own) return own;
    if (accountId < 0) return null;
    return marketSidecarDir(this.spec.service, accountId);
  }

  async list(): Promise<T[]> {
    return [...(await this.load()).values()].map((e) => e.value);
  }

  async get(accountId: number): Promise<T | null> {
    return (await this.load()).get(accountId)?.value ?? null;
  }

  /** Writes one record, built from whatever was there before. */
  save(
    accountId: number,
    build: (previous: T | null) => T,
    extra?: (dir: string) => Promise<void>,
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const entries = await this.load();
      if (this.broken.has(accountId)) {
        log.error(
          `${this.spec.tag} refusing to overwrite unreadable ${this.broken.get(accountId)}`,
        );
        return false;
      }
      const previous = entries.get(accountId) ?? null;
      const value = build(previous?.value ?? null);
      const dir = previous?.dir ?? (await this.dirFor(accountId));
      if (dir === null) {
        log.error(`${this.spec.tag} no folder for account ${accountId} — record not written`);
        return false;
      }

      try {
        await writeJsonFile(join(dir, this.spec.file), value);
        await extra?.(dir);
        // Hydration belongs inside the try: it touches the disk too (an avatar `stat`).
        entries.set(accountId, { value: (await this.spec.hydrate?.(value, dir)) ?? value, dir });
      } catch (err) {
        log.error(`${this.spec.tag} failed to write the record`, err);
        // Whatever is in the map no longer matches the disk, and this store cannot tell which of the two won.
        this.generation = -1;
        return false;
      }
      // The write did not move any folder, so the caches stay as they were.
      this.marketStamp = await dirStamp(await this.marketRoot()).catch(() => -1);
      return true;
    });
  }

  /** Deletes the record. */
  remove(accountId: number, extra?: (dir: string) => Promise<void>): Promise<boolean> {
    return this.enqueue(async () => {
      const entries = await this.load();
      const dir = entries.get(accountId)?.dir ?? this.broken.get(accountId);
      if (dir === undefined) return true;

      try {
        await fs.unlink(join(dir, this.spec.file));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          log.error(`${this.spec.tag} failed to delete the record`, err);
          return false;
        }
      }
      await extra?.(dir).catch((err) => {
        log.error(`${this.spec.tag} failed to clean up beside the record`, err);
      });
      // A market shelf with nothing left on it is swept up — `rmdir` refuses a folder that still holds something.
      if (accountId > 0) await fs.rmdir(dir).catch(() => undefined);
      entries.delete(accountId);
      this.broken.delete(accountId);
      this.marketStamp = await dirStamp(await this.marketRoot()).catch(() => -1);
      return true;
    });
  }

  resetCache(): void {
    this.entries = null;
    this.broken.clear();
    this.generation = -1;
    this.marketStamp = -1;
  }

  resetForTests(): void {
    this.resetCache();
    this.queue = Promise.resolve();
  }
}

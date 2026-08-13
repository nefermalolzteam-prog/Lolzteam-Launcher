import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AccountsCacheStatus } from '@shared-ipc';
import type { AccountSummary } from '@shared-types';
import { app, safeStorage } from 'electron';
import log from 'electron-log/main';

const FILE_NAME = 'accounts-cache.json';

let warnedPlaintext = false;

const serialize = (json: string): Buffer => {
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(json);
  // `token-store.ts:19,38` says this out loud in the same situation and this file used not to.
  if (!warnedPlaintext) {
    warnedPlaintext = true;
    log.warn('[accounts-cache] OS encryption unavailable — the cache is stored in plain text');
  }
  return Buffer.from(json, 'utf8');
};

const deserialize = (buf: Buffer): string => {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      // Legacy plaintext cache written before encryption landed.
    }
  }
  return buf.toString('utf8');
};

// Bump on every shape change to `AccountSummary`: a v2 entry has no `hasMafile`.
const CACHE_VERSION = 7;

const cacheFile = () => join(app.getPath('userData'), FILE_NAME);

interface CachePayload {
  version: number;
  fetchedAt: number;
  items: AccountSummary[];
}

let tmpSeq = 0;

/** One writer, tmp + rename, unique temporary name. */
const writeQueue = { chain: Promise.resolve() as Promise<unknown> };

const writeAtomic = async (data: Buffer): Promise<void> => {
  const path = cacheFile();
  tmpSeq += 1;
  const tmp = `${path}.${process.pid}.${tmpSeq}.tmp`;
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
};

const writeCacheFile = (data: Buffer): Promise<void> => {
  const run = writeQueue.chain.then(
    () => writeAtomic(data),
    () => writeAtomic(data),
  );
  writeQueue.chain = run.catch(() => undefined);
  return run;
};

// Only the public AccountSummary list is persisted.
class AccountsCacheStore {
  private cached: CachePayload | null | undefined = undefined;

  async load(): Promise<CachePayload | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const raw = deserialize(await fs.readFile(cacheFile()));
      const parsed = JSON.parse(raw) as Partial<CachePayload>;
      const usable =
        parsed.version === CACHE_VERSION &&
        Array.isArray(parsed.items) &&
        typeof parsed.fetchedAt === 'number';
      // Loud on purpose.
      if (!usable && parsed.version !== undefined && parsed.version !== CACHE_VERSION) {
        log.info(
          `[accounts-cache] discarding v${parsed.version} cache (current v${CACHE_VERSION}); the list will be re-fetched`,
        );
      }
      this.cached = usable
        ? {
            version: CACHE_VERSION,
            fetchedAt: parsed.fetchedAt as number,
            items: parsed.items as AccountSummary[],
          }
        : null;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[accounts-cache] failed to load', err);
      }
      this.cached = null;
    }
    return this.cached;
  }

  async save(items: AccountSummary[]): Promise<CachePayload> {
    const payload: CachePayload = { version: CACHE_VERSION, fetchedAt: Date.now(), items };
    try {
      await writeCacheFile(serialize(JSON.stringify(payload)));
    } catch (err) {
      log.warn('[accounts-cache] failed to write', err);
    }
    this.cached = payload;
    return payload;
  }

  /** Change one account in place, keeping `fetchedAt` where it was. */
  async patch(itemId: number, patch: Partial<AccountSummary>): Promise<void> {
    const current = await this.load();
    if (!current) return;
    let found = false;
    const items = current.items.map((it) => {
      if (it.itemId !== itemId) return it;
      found = true;
      return { ...it, ...patch };
    });
    if (!found) return;
    const payload: CachePayload = { ...current, items };
    try {
      await writeCacheFile(serialize(JSON.stringify(payload)));
    } catch (err) {
      log.warn('[accounts-cache] failed to write patch', err);
      // The in-memory copy is still updated below: the window has already been told the write succeeded.
    }
    this.cached = payload;
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(cacheFile());
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[accounts-cache] failed to remove', err);
      }
    }
    this.cached = null;
  }
}

const store = new AccountsCacheStore();

export const loadCachedAccounts = (): Promise<CachePayload | null> => store.load();
export const saveCachedAccounts = (items: AccountSummary[]): Promise<CachePayload> =>
  store.save(items);
export const clearCachedAccounts = (): Promise<void> => store.clear();

/** Correct one account in the cache after the launcher changed it on the market. */
export const patchCachedAccount = (itemId: number, patch: Partial<AccountSummary>): Promise<void> =>
  store.patch(itemId, patch);

/** Whether there is anything on disk to show, and how old it is — the whole payload without the payload. */
export const cachedAccountsStatus = async (): Promise<AccountsCacheStatus> => {
  const cached = await store.load();
  return {
    hasCache: cached !== null,
    fetchedAt: cached?.fetchedAt ?? null,
    count: cached?.items.length ?? 0,
  };
};

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  type LauncherSettings,
  PROXY_CAPABLE_SERVICES,
  type ServiceId,
} from '@shared-types';
import { app, safeStorage } from 'electron';
import log from 'electron-log/main';

const FILE_NAME = 'settings.json';

/** Proxy-capable services as of the release that introduced `knownProxyServices`. */
const LEGACY_KNOWN_PROXY_SERVICES: readonly ServiceId[] = [
  'steam',
  'telegram',
  'tiktok',
  'instagram',
  'discord',
];

/** Enables every proxy-capable service the user has never been offered, then records the full set. */
const migrateProxyServices = (merged: LauncherSettings): void => {
  const known = new Set<ServiceId>(
    Array.isArray(merged.knownProxyServices)
      ? merged.knownProxyServices
      : LEGACY_KNOWN_PROXY_SERVICES,
  );
  if (Array.isArray(merged.proxyServices)) {
    const added = PROXY_CAPABLE_SERVICES.filter(
      (id) => !known.has(id) && !merged.proxyServices.includes(id),
    );
    if (added.length > 0) merged.proxyServices = [...merged.proxyServices, ...added];
  }
  merged.knownProxyServices = [...PROXY_CAPABLE_SERVICES];
};

/** Forgets pins whose proxy is no longer in the list. */
const prunePinnedProxies = (merged: LauncherSettings): void => {
  const pins = merged.accountProxies;
  if (pins === null || typeof pins !== 'object') {
    merged.accountProxies = {};
    return;
  }
  const alive = new Set((merged.proxies ?? []).map((p) => p.id));
  const kept: Record<string, string> = {};
  for (const [itemId, proxyId] of Object.entries(pins)) {
    if (alive.has(proxyId)) kept[itemId] = proxyId;
  }
  merged.accountProxies = kept;
};

const settingsFile = () => join(app.getPath('userData'), FILE_NAME);

const serialize = (json: string): Buffer =>
  safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');

const deserialize = (buf: Buffer): string => {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(buf);
    } catch {
      // Legacy plaintext settings written before encryption landed.
    }
  }
  return buf.toString('utf8');
};

/** The error, minus anything it might be quoting. */
const describeError = (err: unknown): string =>
  err instanceof Error
    ? `${err.name}: ${(err as NodeJS.ErrnoException).code ?? 'parse'}`
    : 'unknown';

let tmpSeq = 0;

/** tmp + rename, with a name no concurrent write can collide on. */
const writeAtomic = async (path: string, data: Buffer): Promise<void> => {
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

class SettingsStore extends EventEmitter {
  private cached: LauncherSettings | null = null;

  /** Set when the file on disk could not be read and could not be set aside. */
  private broken = false;

  /** Serialises `update` so two concurrent patches cannot lose one another. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Moves an unreadable settings file out of the way instead of writing over it. */
  private async quarantine(): Promise<void> {
    const file = settingsFile();
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      await fs.rename(file, backup);
      log.error(`[settings] unreadable; original kept at ${backup}, continuing with defaults`);
    } catch (err) {
      this.broken = true;
      log.error(
        `[settings] unreadable and could not be set aside (${describeError(err)}); refusing to overwrite it`,
      );
    }
  }

  async load(): Promise<LauncherSettings> {
    if (this.cached) return this.cached;
    try {
      const raw = deserialize(await fs.readFile(settingsFile()));
      const parsed = JSON.parse(raw) as Partial<LauncherSettings>;
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      if (merged.locale !== 'ru' && merged.locale !== 'en') {
        merged.locale = DEFAULT_SETTINGS.locale;
      }
      migrateProxyServices(merged);
      prunePinnedProxies(merged);
      this.cached = merged;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        this.cached = { ...DEFAULT_SETTINGS };
      } else if (code) {
        // The file is there and could not be read — an antivirus holding it, a permissions problem, a failing disk.
        this.broken = true;
        log.error(`[settings] cannot read (${describeError(err)}); refusing to overwrite it`);
        return { ...DEFAULT_SETTINGS };
      } else {
        log.warn(`[settings] failed to parse (${describeError(err)}), using defaults`);
        await this.quarantine();
        this.cached = { ...DEFAULT_SETTINGS };
      }
    }
    return this.cached;
  }

  update(patch: Partial<LauncherSettings>): Promise<LauncherSettings> {
    const run = this.queue.then(
      () => this.apply(patch),
      () => this.apply(patch),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async apply(patch: Partial<LauncherSettings>): Promise<LauncherSettings> {
    // A previous read failed on I/O.
    if (this.broken) {
      this.broken = false;
      this.cached = null;
    }
    const current = await this.load();
    if (this.broken) {
      throw new Error(
        'Файл настроек не читается. Чтобы не потерять сохранённые прокси и путь к базе, приложение не перезаписывает его — закройте программы, которые могли его занять, и повторите.',
      );
    }
    const next: LauncherSettings = { ...current, ...patch };
    await writeAtomic(settingsFile(), serialize(JSON.stringify(next)));
    this.cached = next;
    this.emit('change', next);
    return next;
  }

  getCached(): LauncherSettings | null {
    return this.cached;
  }
}

const store = new SettingsStore();

export const getSettings = (): Promise<LauncherSettings> => store.load();
export const setSettings = (patch: Partial<LauncherSettings>): Promise<LauncherSettings> =>
  store.update(patch);
export const onSettingsChange = (handler: (s: LauncherSettings) => void): (() => void) => {
  store.on('change', handler);
  return () => store.off('change', handler);
};
export const getCachedSettings = (): LauncherSettings | null => store.getCached();

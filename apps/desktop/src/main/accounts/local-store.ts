import { constants, promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  LocalAccountRecord,
  LocalAccountResult,
  LocalDbEntry,
  LocalDbMoveMode,
  LocalDbSetDirResult,
  LocalDbSwitchResult,
  LocalServiceId,
} from '@shared-types';
import { LOCAL_SERVICE_IDS, isLocalServiceId } from '@shared-types';
import { safeStorage } from 'electron';
import log from 'electron-log/main';
import { getSettings, setSettings } from '../settings/settings-store';
import { emitDbRelocated } from './db-events';
import {
  ACCOUNT_FILE,
  AVATAR_FILE,
  GUARD_FILE,
  LABELS_FILE,
  LEGACY_AVATAR_SUFFIX,
  LEGACY_PROFILE_SUFFIX,
  MARKET_DIR,
  PROFILE_FILE,
  dbKey,
  dbRoot,
  defaultDbRoot,
  folderName,
  legacyDir,
  legacyKind,
  marketSidecarDir,
  moveFile,
  movePath,
  pathExists,
  readJsonFile,
  slugify,
  stampsMatch,
  subDirs,
  uniqueName,
  walkServiceDir,
  writeJsonFile,
} from './db-paths';
import type { ValidatedLocalAccount } from './local-validate';

const LEGACY_FILE = 'local-accounts.json';

/** How many folders the switcher remembers. */
const MAX_BASES = 20;

/** The list of remembered bases with `dir` in it. */
const withBase = (list: readonly string[], dir: string | null): string[] => {
  if (!dir || list.some((d) => dbKey(d) === dbKey(dir))) return [...list];
  return [...list, dir].slice(-MAX_BASES);
};

/** Non-empty string, or null — the record's optional fields use the same test. */
const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const asInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

/** Label ids off a parsed file: negative integers, deduplicated, order kept. */
const asLabelIds = (v: unknown): number[] => {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const item of v) {
    const id = asInt(item);
    if (id !== null && id < 0 && !out.includes(id)) out.push(id);
  }
  return out;
};

/** Builds one record from a parsed file. */
const buildRecord = (
  r: Record<string, unknown>,
  service: LocalServiceId,
  id: number,
  fallbackLabel: string,
): LocalAccountRecord | null => {
  const label = asString(r.label) ?? fallbackLabel;
  const labels = asLabelIds(r.labels);
  const now = Date.now();
  const createdAt = asInt(r.createdAt) ?? now;
  const updatedAt = asInt(r.updatedAt) ?? createdAt;
  // Positive by definition — market ids are, local ones are not.
  const fromMarket = asInt(r.marketItemId);
  const marketItemId = fromMarket !== null && fromMarket > 0 ? fromMarket : null;

  if (service === 'steam') {
    const login = asString(r.login);
    const password = asString(r.password);
    if (login === null || password === null) return null;
    return {
      id,
      service,
      label,
      labels,
      login,
      password,
      sharedSecret: asString(r.sharedSecret),
      // Written since the maFile started being kept whole; a record from before that simply has neither.
      identitySecret: asString(r.identitySecret),
      deviceId: asString(r.deviceId),
      marketItemId,
      createdAt,
      updatedAt,
    };
  }

  const authKey = asString(r.authKey);
  const dcId = asInt(r.dcId);
  if (authKey === null || dcId === null) return null;
  return {
    id,
    service,
    label,
    labels,
    authKey,
    dcId,
    phone: asString(r.phone),
    userId: asInt(r.userId),
    marketItemId,
    createdAt,
    updatedAt,
  };
};

/** Ids count down from -1 so they can never collide with a market item id. */
const freeId = (used: ReadonlySet<number>): number =>
  Math.min(-1, ...[...used].map((id) => id - 1));

interface Entry {
  record: LocalAccountRecord;
  /** Absolute path of the account's own folder — the label can change, this follows it. */
  dir: string;
  /** Containing user folder relative to the service root; `''` at the top level. */
  group: string;
}

/** What the renderer needs to show and sort the base by folder. */
export interface LocalAccountFolder {
  id: number;
  service: LocalServiceId;
  dir: string;
  group: string;
}

const placementsOf = (entries: ReadonlyMap<number, Entry>): LocalAccountFolder[] =>
  [...entries.values()].map((e) => ({
    id: e.record.id,
    service: e.record.service,
    dir: e.dir,
    group: e.group,
  }));

class LocalAccountsStore {
  private entries: Map<number, Entry> | null = null;
  /** Lower-cased child names per parent folder, readable or not — see `uniqueName`. */
  private taken = new Map<string, Set<string>>();
  /** Folder mtimes at the last scan; a mismatch means someone moved files in. */
  private stamps = new Map<string, number>();
  /** User folders per service, so the renderer can offer them without a second walk. */
  private groups = new Map<LocalServiceId, string[]>();
  /** Set when a folder itself could not be read; blocks every write. */
  private unreadable = false;
  /** Roots already checked for a pre-folder-layout store. */
  private migrated = new Set<string>();
  /** Bumped on every scan and every write — sidecar stores watch it to drop caches. */
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();

  /** Serialises mutations so two concurrent IPC calls cannot clobber each other. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** A read, taken in the same queue the writes go through. */
  private read<T>(fn: (entries: Map<number, Entry>) => T): Promise<T> {
    return this.enqueue(async () => fn(await this.load()));
  }

  private names(parent: string): Set<string> {
    const key = parent.toLowerCase();
    const existing = this.taken.get(key);
    if (existing) return existing;
    const created = new Set<string>();
    this.taken.set(key, created);
    return created;
  }

  /** Remembers a folder as it is right after our own write, so we do not rescan. */
  private async restamp(): Promise<void> {
    const root = await dbRoot();
    for (const service of LOCAL_SERVICE_IDS) {
      const dir = join(root, service);
      if (this.stamps.has(dir)) this.stamps.set(dir, await dirStampSafe(dir));
    }
    this.generation++;
  }

  private async load(): Promise<Map<number, Entry>> {
    if (this.entries && (await stampsMatch(this.stamps))) return this.entries;
    return this.scan();
  }

  private async scan(): Promise<Map<number, Entry>> {
    const root = await dbRoot();
    const entries = new Map<number, Entry>();
    const used = new Set<number>();
    /** Folders whose id had to be assigned here; rewritten so the fix sticks. */
    const repairs: { dir: string; record: LocalAccountRecord }[] = [];

    this.taken.clear();
    this.stamps.clear();
    this.groups.clear();
    this.unreadable = false;
    this.generation++;

    for (const service of LOCAL_SERVICE_IDS) {
      const serviceRoot = join(root, service);
      let walk: Awaited<ReturnType<typeof walkServiceDir>>;
      try {
        walk = await walkServiceDir(serviceRoot);
      } catch (err) {
        // The folder is there but unreadable (permissions, locked).
        this.unreadable = true;
        log.error(`[local-accounts] failed to read ${serviceRoot}`, err);
        continue;
      }

      if (walk.looseFiles.length > 0) {
        // A database written by the previous layout: files straight in the service folder.
        try {
          await this.migrateFlat(serviceRoot, service, walk);
          walk = await walkServiceDir(serviceRoot);
        } catch (err) {
          log.error(`[local-accounts] failed to convert ${serviceRoot} to folders`, err);
        }
      }

      for (const [dir, stamp] of walk.stamps) this.stamps.set(dir, stamp);
      // A service folder that does not exist yet still has to be watched.
      if (!this.stamps.has(serviceRoot)) {
        this.stamps.set(serviceRoot, await dirStampSafe(serviceRoot));
      }
      this.groups.set(service, walk.groups.sort());
      for (const account of walk.accounts) {
        this.names(dirname(account.dir)).add(account.name.toLowerCase());
      }
      // The user's folders are taken names too, and for a worse reason than tidiness.
      for (const group of walk.groups) {
        const dir = join(serviceRoot, ...group.split('/'));
        this.names(dirname(dir)).add(basename(dir).toLowerCase());
      }

      for (const account of [...walk.accounts].sort((a, b) => a.dir.localeCompare(b.dir))) {
        const rel = `${service}/${account.name}`;
        let raw: unknown;
        try {
          raw = await readJsonFile(join(account.dir, ACCOUNT_FILE));
        } catch (err) {
          log.error(`[local-accounts] skipping ${rel}`, err);
          continue;
        }
        if (!raw || typeof raw !== 'object') {
          log.error(`[local-accounts] skipping ${rel}: not an object`);
          continue;
        }

        const r = raw as Record<string, unknown>;
        const stored = asInt(r.id);
        // A folder copied in from another database can carry an id we already handed out — or none at all.
        const keep = stored !== null && stored < 0 && !used.has(stored);
        const id = keep ? stored : freeId(used);
        const record = buildRecord(r, service, id, account.name);
        if (!record) {
          log.error(`[local-accounts] skipping ${rel}: incomplete record`);
          continue;
        }

        used.add(id);
        entries.set(id, { record, dir: account.dir, group: account.group });
        if (!keep) repairs.push({ dir: account.dir, record });
      }
    }

    this.entries = entries;
    await this.migrateLegacy(root, entries, used);

    for (const { dir, record } of repairs) {
      try {
        await writeJsonFile(join(dir, ACCOUNT_FILE), record);
        log.info(`[local-accounts] ${basename(dir)} adopted id ${record.id}`);
      } catch (err) {
        log.error(`[local-accounts] failed to write back ${dir}`, err);
      }
    }

    return entries;
  }

  /** Turns the previous layout — a file per account straight in the service folder, sidecars beside it. */
  private async migrateFlat(
    serviceRoot: string,
    service: LocalServiceId,
    walk: Awaited<ReturnType<typeof walkServiceDir>>,
  ): Promise<void> {
    const taken = new Set([
      ...walk.accounts.filter((a) => !a.group).map((a) => a.name.toLowerCase()),
      ...walk.groups.map((g) => g.toLowerCase()),
    ]);
    /** `accountId` → its new folder, for the sidecar pass below. */
    const folders = new Map<number, string>();
    /** Old profile base name → the folder its avatar belongs in. */
    const avatarTargets = new Map<string, string>();
    let moved = 0;

    const sorted = [...walk.looseFiles].sort();
    for (const file of sorted) {
      if (legacyKind(file) !== 'account') continue;
      const path = join(serviceRoot, file);
      let raw: unknown;
      try {
        raw = await readJsonFile(path);
      } catch (err) {
        log.error(`[local-accounts] leaving ${service}/${file} where it is`, err);
        continue;
      }
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;

      const name = uniqueName(
        folderName({
          service,
          label: asString(r.label) ?? file.replace(/\.json$/i, ''),
          userId: asInt(r.userId),
        }),
        '',
        taken,
      );
      const dir = join(serviceRoot, name);
      await fs.mkdir(dir, { recursive: true });
      await moveFile(path, join(dir, ACCOUNT_FILE));
      taken.add(name.toLowerCase());
      const id = asInt(r.id);
      if (id !== null) folders.set(id, dir);
      moved++;
    }

    for (const file of sorted) {
      const kind = legacyKind(file);
      if (kind !== 'guard' && kind !== 'profile') continue;
      const path = join(serviceRoot, file);
      let accountId: number | null = null;
      try {
        const raw = await readJsonFile(path);
        if (raw && typeof raw === 'object')
          accountId = asInt((raw as Record<string, unknown>).accountId);
      } catch (err) {
        log.error(`[local-accounts] leaving ${service}/${file} where it is`, err);
        continue;
      }
      if (accountId === null) continue;

      const dir = folders.get(accountId) ?? (await marketSidecarDir(service, accountId));
      await fs.mkdir(dir, { recursive: true });
      await moveFile(path, join(dir, kind === 'guard' ? GUARD_FILE : PROFILE_FILE));
      if (kind === 'profile') {
        avatarTargets.set(file.slice(0, -LEGACY_PROFILE_SUFFIX.length).toLowerCase(), dir);
      }
      moved++;
    }

    for (const file of sorted) {
      if (legacyKind(file) !== 'avatar') continue;
      const dir = avatarTargets.get(file.slice(0, -LEGACY_AVATAR_SUFFIX.length).toLowerCase());
      // An avatar whose profile we could not place says nothing on its own.
      if (!dir) continue;
      await moveFile(join(serviceRoot, file), join(dir, AVATAR_FILE));
      moved++;
    }

    if (moved > 0) log.info(`[local-accounts] moved ${moved} file(s) in ${service} into folders`);
  }

  /** One-off import of the single encrypted file this store used to be. */
  private async migrateLegacy(
    root: string,
    entries: Map<number, Entry>,
    used: Set<number>,
  ): Promise<void> {
    if (this.migrated.has(root)) return;
    const path = join(await legacyDir(), LEGACY_FILE);
    if (!(await pathExists(path))) {
      this.migrated.add(root);
      return;
    }

    let list: unknown[];
    try {
      const buf = await fs.readFile(path);
      let text: string;
      if (safeStorage.isEncryptionAvailable()) {
        try {
          text = safeStorage.decryptString(buf);
        } catch {
          // Written before encryption was available (or by another OS user).
          text = buf.toString('utf8');
        }
      } else {
        text = buf.toString('utf8');
      }
      const parsed = JSON.parse(text) as { accounts?: unknown };
      if (!Array.isArray(parsed?.accounts)) throw new Error('no account list');
      list = parsed.accounts;
    } catch (err) {
      // Nothing is renamed or overwritten: a file we cannot read may still be readable on the machine that wrote it.
      log.error(`[local-accounts] legacy store at ${path} could not be read`, err);
      this.migrated.add(root);
      return;
    }

    let imported = 0;
    let failed = 0;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const service = r.service;
      if (!isLocalServiceId(service)) continue;

      const stored = asInt(r.id);
      if (stored !== null && entries.has(stored)) continue; // already in the folders
      const id = stored !== null && stored < 0 ? stored : freeId(used);
      const record = buildRecord(r, service, id, 'account');
      if (!record) continue;

      const serviceRoot = join(root, service);
      const name = uniqueName(folderName(record), '', this.names(serviceRoot));
      const dir = join(serviceRoot, name);
      try {
        await writeJsonFile(join(dir, ACCOUNT_FILE), record);
      } catch (err) {
        log.error(`[local-accounts] failed to migrate account ${id}`, err);
        failed++;
        continue;
      }
      this.names(serviceRoot).add(name.toLowerCase());
      used.add(id);
      entries.set(id, { record, dir, group: '' });
      imported++;
    }

    if (failed > 0) {
      // Leave the old file and try again next time — the import is idempotent.
      log.error(`[local-accounts] migration incomplete, keeping ${path}`);
      return;
    }
    try {
      await fs.rename(path, `${path}.migrated-${Date.now()}`);
    } catch (err) {
      log.error('[local-accounts] failed to rename the legacy store', err);
    }
    this.migrated.add(root);
    log.info(`[local-accounts] migrated ${imported} record(s) from ${path}`);
  }

  private mutate(
    fn: (entries: Map<number, Entry>) => Promise<LocalAccountResult>,
  ): Promise<LocalAccountResult> {
    return this.enqueue(async () => {
      const entries = await this.load();
      if (this.unreadable) return { ok: false, message: 'store_unreadable' };
      try {
        return await fn(entries);
      } catch (err) {
        log.error('[local-accounts] failed to write the store', err);
        return { ok: false, message: 'store_write_failed' };
      }
    });
  }

  async list(): Promise<LocalAccountRecord[]> {
    // Newest last, like the file-backed store handed them out.
    return this.read((entries) =>
      [...entries.values()].map((e) => e.record).sort((a, b) => b.id - a.id),
    );
  }

  async get(id: number): Promise<LocalAccountRecord | null> {
    return this.read((entries) => entries.get(id)?.record ?? null);
  }

  /** Where each account keeps its files, and which scan that answer came from. */
  async folders(): Promise<{ generation: number; folders: LocalAccountFolder[] }> {
    return this.read((entries) => ({
      generation: this.generation,
      folders: placementsOf(entries),
    }));
  }

  async folderOf(id: number): Promise<string | null> {
    return this.read((entries) => entries.get(id)?.dir ?? null);
  }

  /** Every account with the folder it sits in — for filtering and the folder tree. */
  async placements(): Promise<LocalAccountFolder[]> {
    return this.read(placementsOf);
  }

  /** User folders that exist, per service, deepest paths spelled in full. */
  async groupList(): Promise<Record<LocalServiceId, string[]>> {
    return this.read(() => {
      const out = {} as Record<LocalServiceId, string[]>;
      for (const service of LOCAL_SERVICE_IDS) out[service] = this.groups.get(service) ?? [];
      return out;
    });
  }

  create(
    value: ValidatedLocalAccount,
    marketItemId: number | null = null,
  ): Promise<LocalAccountResult> {
    return this.mutate(async (entries) => {
      const now = Date.now();
      const id = freeId(new Set(entries.keys()));
      const record: LocalAccountRecord = {
        ...value,
        id,
        labels: [],
        // A parameter rather than a field of `value`: the form cannot type an origin and must not be able to claim one.
        marketItemId,
        createdAt: now,
        updatedAt: now,
      };

      const serviceRoot = join(await dbRoot(), record.service);
      const name = uniqueName(folderName(record), '', this.names(serviceRoot));
      const dir = join(serviceRoot, name);
      await writeJsonFile(join(dir, ACCOUNT_FILE), record);

      this.names(serviceRoot).add(name.toLowerCase());
      entries.set(id, { record, dir, group: '' });
      await this.restamp();
      return { ok: true, id };
    });
  }

  update(id: number, value: ValidatedLocalAccount): Promise<LocalAccountResult> {
    return this.mutate(async (entries) => {
      const previous = entries.get(id);
      if (!previous) return { ok: false, message: 'not_found' };
      if (previous.record.service !== value.service) {
        return { ok: false, message: 'service_mismatch' };
      }

      const record: LocalAccountRecord = {
        ...value,
        id,
        // The edit form knows nothing about labels, so they are carried over rather than taken from `value`.
        labels: previous.record.labels,
        // Same reasoning, and a stronger one: where an account came from is a fact about its past, and no edit can change it.
        marketItemId: previous.record.marketItemId,
        createdAt: previous.record.createdAt,
        updatedAt: Date.now(),
      };

      // A renamed account gets a renamed folder — and the folder moves first.
      let dir = previous.dir;
      const parent = dirname(previous.dir);
      const wanted = folderName(record);
      if (basename(dir).toLowerCase() !== wanted.toLowerCase()) {
        const names = this.names(parent);
        names.delete(basename(previous.dir).toLowerCase());
        const name = uniqueName(wanted, '', names);
        dir = join(parent, name);
        try {
          await fs.rename(previous.dir, dir);
          names.add(name.toLowerCase());
        } catch (err) {
          // Windows locks a folder someone has open in Explorer.
          log.warn(`[local-accounts] could not rename ${previous.dir}`, err);
          dir = previous.dir;
          names.add(basename(dir).toLowerCase());
        }
      }

      await writeJsonFile(join(dir, ACCOUNT_FILE), record);
      entries.set(id, { record, dir, group: previous.group });
      await this.restamp();
      return { ok: true, id };
    });
  }

  /** Moves an account into one of the user's folders, or back to the top. */
  moveToGroup(id: number, group: string): Promise<LocalAccountResult> {
    return this.mutate(async (entries) => {
      const entry = entries.get(id);
      if (!entry) return { ok: false, message: 'not_found' };

      const clean = normaliseGroup(group);
      if (clean === entry.group) return { ok: true, id };

      const serviceRoot = join(await dbRoot(), entry.record.service);
      const parent = clean ? join(serviceRoot, ...clean.split('/')) : serviceRoot;
      await fs.mkdir(parent, { recursive: true });
      // Every folder just created is a name an account may no longer take.
      let walked = serviceRoot;
      for (const segment of clean ? clean.split('/') : []) {
        this.names(walked).add(segment.toLowerCase());
        walked = join(walked, segment);
      }

      const names = this.names(parent);
      const name = uniqueName(basename(entry.dir), '', names);
      const dir = join(parent, name);
      await fs.rename(entry.dir, dir);

      this.names(dirname(entry.dir)).delete(basename(entry.dir).toLowerCase());
      names.add(name.toLowerCase());
      entries.set(id, { ...entry, dir, group: clean });
      if (clean && !(this.groups.get(entry.record.service) ?? []).includes(clean)) {
        this.groups.set(
          entry.record.service,
          [...(this.groups.get(entry.record.service) ?? []), clean].sort(),
        );
      }
      // Both parents changed, and one of them may be a folder we have never stamped.
      this.entries = null;
      this.generation++;
      return { ok: true, id };
    });
  }

  /** Replaces the set of labels on one account. */
  setLabels(id: number, labels: readonly number[]): Promise<LocalAccountResult> {
    return this.mutate(async (entries) => {
      const entry = entries.get(id);
      if (!entry) return { ok: false, message: 'not_found' };

      const next = asLabelIds([...labels]);
      const record: LocalAccountRecord = { ...entry.record, labels: next, updatedAt: Date.now() };
      await writeJsonFile(join(entry.dir, ACCOUNT_FILE), record);
      entries.set(id, { ...entry, record });
      await this.restamp();
      return { ok: true, id };
    });
  }

  remove(id: number): Promise<LocalAccountResult> {
    return this.mutate(async (entries) => {
      const entry = entries.get(id);
      if (!entry) return { ok: false, message: 'not_found' };

      // The whole folder goes, sidecars included: the authenticator and the last check belong to the account.
      for (const name of await fs.readdir(entry.dir)) {
        if (name === ACCOUNT_FILE) continue;
        await fs.rm(join(entry.dir, name), { recursive: true, force: true });
      }
      await fs.rm(join(entry.dir, ACCOUNT_FILE), { force: true });
      await fs.rm(entry.dir, { recursive: true, force: true });
      this.names(dirname(entry.dir)).delete(basename(entry.dir).toLowerCase());
      entries.delete(id);
      await this.restamp();
      return { ok: true, id };
    });
  }

  /** Any account folder, or any market sidecar, means "a database lives here". */
  private async hasDatabase(root: string): Promise<boolean> {
    for (const service of LOCAL_SERVICE_IDS) {
      const serviceRoot = join(root, service);
      const walk = await walkServiceDir(serviceRoot);
      if (walk.accounts.length > 0 || walk.looseFiles.length > 0) return true;
      if ((await subDirs(join(serviceRoot, MARKET_DIR))).length > 0) return true;
    }
    return false;
  }

  /** Points the store at another folder, taking the files along. */
  moveTo(dir: string | null, mode: LocalDbMoveMode): Promise<LocalDbSetDirResult> {
    return this.enqueue(async () => {
      const from = await dbRoot();
      const to = dir ?? defaultDbRoot();
      if (dbKey(from) === dbKey(to)) return { ok: false, reason: 'same_dir' };

      try {
        await fs.mkdir(to, { recursive: true });
        await fs.access(to, constants.W_OK);
      } catch (err) {
        log.error('[local-accounts] target folder is not writable', err);
        return { ok: false, reason: 'not_writable' };
      }

      let hasTarget: boolean;
      try {
        hasTarget = await this.hasDatabase(to);
      } catch (err) {
        log.error('[local-accounts] failed to inspect the target folder', err);
        return { ok: false, reason: 'move_failed' };
      }
      // The renderer has to pick between the two databases first.
      if (hasTarget && mode === 'move') return { ok: false, reason: 'target_exists' };

      try {
        if (hasTarget && mode === 'adopt') {
          log.info(`[local-accounts] keeping the database already in ${to}`);
        } else {
          const stamp = Date.now();
          for (const service of LOCAL_SERVICE_IDS) {
            const source = join(from, service);
            const target = join(to, service);
            if (!(await pathExists(source))) continue;
            if (hasTarget && (await pathExists(target))) {
              await fs.rename(target, `${target}.bak-${stamp}`);
            }
            await movePath(source, target);
          }

          // The labels sit at the root of the base, outside every service folder.
          const fromLabels = join(from, LABELS_FILE);
          if (await pathExists(fromLabels)) {
            const target = join(to, LABELS_FILE);
            if (await pathExists(target)) await fs.rename(target, `${target}.bak-${stamp}`);
            await movePath(fromLabels, target);
          }
        }
      } catch (err) {
        log.error('[local-accounts] failed to move the store', err);
        return { ok: false, reason: 'move_failed' };
      }

      // Whatever is in the new folder is now the truth — re-read it.
      await this.adopt(dir);
      return { ok: true, dir };
    });
  }

  /** Reads another base, leaving both folders exactly where they are. */
  switchTo(dir: string | null): Promise<LocalDbSwitchResult> {
    return this.enqueue(async () => {
      const to = dir ?? defaultDbRoot();
      const settings = await getSettings();
      if (dbKey(await dbRoot()) === dbKey(to)) {
        // Already reading it.
        const known = withBase(settings.localDbDirs, dir);
        if (known.length !== settings.localDbDirs.length) {
          await setSettings({ localDbDirs: known });
        }
        return { ok: true, dir };
      }

      if (dir !== null && !(await pathExists(to))) return { ok: false, reason: 'missing' };
      try {
        await fs.mkdir(to, { recursive: true });
        await fs.access(to, constants.W_OK);
      } catch (err) {
        log.error(`[local-accounts] cannot open the base in ${to}`, err);
        return { ok: false, reason: 'not_writable' };
      }

      await this.adopt(dir);
      log.info(`[local-accounts] now reading the base in ${to}`);
      return { ok: true, dir };
    });
  }

  /** Points every reader at `dir` and remembers it. */
  private async adopt(dir: string | null): Promise<void> {
    const settings = await getSettings();
    this.forget();
    emitDbRelocated();
    await setSettings({ localDbDir: dir, localDbDirs: withBase(settings.localDbDirs, dir) });
  }

  /** Every base the user has opened, with enough about each to choose between them. */
  bases(): Promise<LocalDbEntry[]> {
    return this.enqueue(() => this.describeBases());
  }

  /** Drops a base from the list. */
  forgetBase(dir: string): Promise<LocalDbEntry[]> {
    return this.enqueue(async () => {
      const settings = await getSettings();
      const next = settings.localDbDirs.filter((d) => dbKey(d) !== dbKey(dir));
      if (next.length !== settings.localDbDirs.length) await setSettings({ localDbDirs: next });
      return this.describeBases();
    });
  }

  private async describeBases(): Promise<LocalDbEntry[]> {
    const settings = await getSettings();
    const currentKey = dbKey(settings.localDbDir ?? defaultDbRoot());
    const out: LocalDbEntry[] = [];
    const seen = new Set<string>();

    for (const dir of [null, ...settings.localDbDirs, settings.localDbDir]) {
      const path = dir ?? defaultDbRoot();
      const key = dbKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        dir,
        path,
        current: key === currentKey,
        // The app's own folder is made on demand, so its absence is not news.
        ...(await describeBase(path, dir === null)),
      });
    }
    return out;
  }

  /** Where the database lives right now — for the settings screen. */
  currentDir(): Promise<string> {
    return dbRoot();
  }

  /** Drops the in-memory copy so the next call re-reads the folders. */
  private forget(): void {
    this.entries = null;
    this.taken.clear();
    this.stamps.clear();
    this.groups.clear();
    this.migrated.clear();
    this.unreadable = false;
    this.generation++;
  }

  /** Test seam: the reset above, plus a queue with nothing left in it. */
  resetForTests(): void {
    this.forget();
    this.queue = Promise.resolve();
  }
}

/** A folder that vanished under us stamps as 0 rather than throwing mid-write. */
const dirStampSafe = async (dir: string): Promise<number> => {
  try {
    return (await fs.stat(dir)).mtimeMs;
  } catch {
    return 0;
  }
};

/** What one base folder holds, without loading it. */
const describeBase = async (
  path: string,
  isDefault: boolean,
): Promise<Pick<LocalDbEntry, 'available' | 'counts'>> => {
  if (!isDefault && !(await pathExists(path))) return { available: false, counts: null };
  try {
    const counts = {} as Record<LocalServiceId, number>;
    for (const service of LOCAL_SERVICE_IDS) {
      const walk = await walkServiceDir(join(path, service));
      counts[service] =
        walk.accounts.length + walk.looseFiles.filter((f) => legacyKind(f) === 'account').length;
    }
    return { available: true, counts };
  } catch (err) {
    // There but unreadable — a locked folder, a drive that answers and then does not.
    log.error(`[local-accounts] failed to inspect the base in ${path}`, err);
    return { available: true, counts: null };
  }
};

/** `' Work / Old '` → `'Work/Old'`, with every segment safe as a folder name. */
export const normaliseGroup = (group: string): string =>
  group
    .split(/[/\\]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(slugify)
    .slice(0, 3)
    .join('/');

const store = new LocalAccountsStore();

export const listLocalAccounts = (): Promise<LocalAccountRecord[]> => store.list();
export const getLocalAccount = (id: number): Promise<LocalAccountRecord | null> => store.get(id);
export const createLocalAccount = (
  value: ValidatedLocalAccount,
  marketItemId: number | null = null,
): Promise<LocalAccountResult> => store.create(value, marketItemId);
export const updateLocalAccount = (
  id: number,
  value: ValidatedLocalAccount,
): Promise<LocalAccountResult> => store.update(id, value);
export const deleteLocalAccount = (id: number): Promise<LocalAccountResult> => store.remove(id);
export const moveLocalAccountToGroup = (id: number, group: string): Promise<LocalAccountResult> =>
  store.moveToGroup(id, group);
export const setLocalAccountLabels = (
  id: number,
  labels: readonly number[],
): Promise<LocalAccountResult> => store.setLabels(id, labels);
export const listLocalAccountFolders = (): Promise<LocalAccountFolder[]> => store.placements();
export const listLocalGroups = (): Promise<Record<LocalServiceId, string[]>> => store.groupList();
export const localAccountFolder = (id: number): Promise<string | null> => store.folderOf(id);
/** Folder index plus the generation it belongs to — the sidecar stores' cache key. */
export const localAccountFolders = (): Promise<{
  generation: number;
  folders: LocalAccountFolder[];
}> => store.folders();
export const moveLocalStoreTo = (
  dir: string | null,
  mode: LocalDbMoveMode,
): Promise<LocalDbSetDirResult> => store.moveTo(dir, mode);
/** Repoints the app at another base folder without touching a single file. */
export const switchLocalStoreTo = (dir: string | null): Promise<LocalDbSwitchResult> =>
  store.switchTo(dir);
export const listLocalDbBases = (): Promise<LocalDbEntry[]> => store.bases();
export const forgetLocalDbBase = (dir: string): Promise<LocalDbEntry[]> => store.forgetBase(dir);
export const getLocalStoreDir = (): Promise<string> => store.currentDir();
export const resetLocalAccountsStoreForTests = (): void => store.resetForTests();

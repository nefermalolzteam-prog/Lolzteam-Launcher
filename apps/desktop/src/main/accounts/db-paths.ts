import { promises as fs, type Dirent } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LocalServiceId } from '@shared-types';
import { app } from 'electron';
import { getCachedSettings, getSettings } from '../settings/settings-store';

/** The file that makes a folder an account. */
export const ACCOUNT_FILE = 'account.json';
/** Steam authenticator secrets — the one sidecar that holds credentials. */
export const GUARD_FILE = 'guard.json';
/** What the last Telegram check learned, and the picture it downloaded. */
export const PROFILE_FILE = 'profile.json';
export const AVATAR_FILE = 'avatar.jpg';
/** The last verdict for services whose check has nothing richer to store. */
export const CHECK_FILE = 'check.json';

/** The user's own labels, at the root of the base rather than inside a service. */
export const LABELS_FILE = 'labels.json';

/** Sidecars for accounts that have no folder of their own. */
export const MARKET_DIR = '_market';

/** Names the pre-folder layout used, kept only so the migration can find them. */
export const LEGACY_GUARD_SUFFIX = '.guard.json';
export const LEGACY_PROFILE_SUFFIX = '.profile.json';
export const LEGACY_AVATAR_SUFFIX = '.avatar.jpg';

/** How deep the scan follows folders the user made. */
const MAX_DEPTH = 4;

/** Where the base lives when the setting says nothing. */
export const defaultDbRoot = (): string => join(app.getPath('userData'), 'accounts');

/** `null` in the setting means "the app's own data folder". */
export const dbRoot = async (): Promise<string> => {
  const settings = getCachedSettings() ?? (await getSettings());
  return settings.localDbDir ?? defaultDbRoot();
};

/** The comparable form of a path — two spellings of one folder give one key. */
export const dbKey = (path: string): string =>
  process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

export const serviceDir = async (service: LocalServiceId): Promise<string> =>
  join(await dbRoot(), service);

/** Where sidecars of a market account go: `<root>/<service>/_market/<accountId>`. */
export const marketSidecarDir = async (
  service: LocalServiceId,
  accountId: number,
): Promise<string> => join(await dbRoot(), service, MARKET_DIR, String(accountId));

/** Where a pre-folder-layout store would be — the source for the one-off migration. */
export const legacyDir = async (): Promise<string> => {
  const settings = getCachedSettings() ?? (await getSettings());
  return settings.localDbDir ?? app.getPath('userData');
};

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what Windows rejects in a file name
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;
const TRAILING = /[. ]+$/;

/** A label turned into something Windows will accept as a folder name: illegal characters out, whitespace collapsed. */
export const slugify = (raw: string): string => {
  let name = raw.replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim().replace(TRAILING, '');
  if (name.length > 64) name = name.slice(0, 64).trim().replace(TRAILING, '');
  if (RESERVED.test(name) || name === MARKET_DIR || name.startsWith('.')) name = `_${name}`;
  return name || 'account';
};

/** `base + suffix`, or `base (2) + suffix` when that is taken. */
export const uniqueName = (base: string, suffix: string, taken: ReadonlySet<string>): string => {
  let candidate = `${base}${suffix}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${suffix}`;
  return candidate;
};

/** What a folder needs to know about the account it holds to be named for it. */
export interface AccountNaming {
  readonly service: LocalServiceId;
  readonly label: string;
  /** The service's own id for the account, where it has one. */
  readonly userId?: number | null;
}

/** What an account's folder is called. */
export const folderName = ({ service, label, userId }: AccountNaming): string =>
  service === 'telegram' && userId ? slugify(String(userId)) : slugify(label);

/** One account's folder, as found on disk. */
export interface AccountDir {
  /** Absolute path of the folder holding `account.json`. */
  dir: string;
  /** The folder's own name — see {@link folderName}. */
  name: string;
  /** Containing user folder relative to the service root; `''` at the top level. */
  group: string;
}

export interface ServiceWalk {
  accounts: AccountDir[];
  /** User folders, relative to the service root, deepest path spelled in full. */
  groups: string[];
  /** Folders whose mtime decides whether a rescan is needed: the service root and every user folder. */
  stamps: Map<string, number>;
  /** Files lying loose in the service root — that is the pre-folder layout. */
  looseFiles: string[];
}

const emptyWalk = (): ServiceWalk => ({
  accounts: [],
  groups: [],
  stamps: new Map(),
  looseFiles: [],
});

/** Reads one service folder into its accounts, its user folders and whatever the previous layout left lying in it. */
export const walkServiceDir = async (root: string): Promise<ServiceWalk> => {
  const walk = emptyWalk();

  const visit = async (dir: string, group: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // A folder that is not there yet is simply empty; anything else (locked, no permission) is the caller's to report.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    walk.stamps.set(dir, await dirStamp(dir));
    if (group) walk.groups.push(group);

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.isDirectory()) {
        if (!group && entry.isFile()) walk.looseFiles.push(entry.name);
        continue;
      }
      if (!group && entry.name === MARKET_DIR) continue;

      const child = join(dir, entry.name);
      if (await pathExists(join(child, ACCOUNT_FILE))) {
        walk.accounts.push({ dir: child, name: entry.name, group });
        continue;
      }
      if (depth >= MAX_DEPTH) continue;
      await visit(child, group ? `${group}/${entry.name}` : entry.name, depth + 1);
    }
  };

  await visit(root, '', 0);
  return walk;
};

/** Folder mtimes as the walk saw them still match — no rescan needed. */
export const stampsMatch = async (stamps: ReadonlyMap<string, number>): Promise<boolean> => {
  for (const [dir, stamp] of stamps) {
    if ((await dirStamp(dir)) !== stamp) return false;
  }
  return true;
};

export interface DirListing {
  names: string[];
  /** Directory mtime — changes when a file is added or removed, so it detects drop-ins. */
  stamp: number;
}

/** Listing of a folder that may not exist yet; any other failure is the caller's problem. */
export const readDirListing = async (dir: string): Promise<DirListing> => {
  try {
    const [names, stat] = await Promise.all([fs.readdir(dir), fs.stat(dir)]);
    return { names, stamp: stat.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { names: [], stamp: 0 };
    throw err;
  }
};

export const dirStamp = async (dir: string): Promise<number> => {
  try {
    return (await fs.stat(dir)).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
};

/** Sub-folder names of a folder that may not exist — used to list `_market`. */
export const subDirs = async (dir: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
};

const isJson = (name: string): boolean => name.toLowerCase().endsWith('.json');

/** Loose files from the old layout, split by what they were. */
export const legacyKind = (name: string): 'guard' | 'profile' | 'avatar' | 'account' | null => {
  const lower = name.toLowerCase();
  if (lower.startsWith('.')) return null;
  if (lower.endsWith(LEGACY_GUARD_SUFFIX)) return 'guard';
  if (lower.endsWith(LEGACY_PROFILE_SUFFIX)) return 'profile';
  if (lower.endsWith(LEGACY_AVATAR_SUFFIX)) return 'avatar';
  return isJson(name) ? 'account' : null;
};

/** A temporary name no other write can be using. */
let tmpSeq = 0;
const tmpPath = (path: string): string => `${path}.${process.pid}.${tmpSeq++}.tmp`;

/** Pretty-printed, `0o600`, and atomic — a crash mid-write cannot truncate the old file. */
export const writeJsonFile = async (path: string, value: unknown): Promise<void> =>
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

/** The same guarantees for a file that is not text — the avatar beside a profile. */
export const writeBinaryFile = async (path: string, data: Uint8Array): Promise<void> =>
  writeAtomic(path, data);

const writeAtomic = async (path: string, data: string | Uint8Array): Promise<void> => {
  const tmp = tmpPath(path);
  try {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
};

export const readJsonFile = async (path: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(path, 'utf8'));

/** `rename` cannot cross a device boundary, and a picked folder often is one. */
export const moveFile = async (from: string, to: string): Promise<void> => {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
};

/** Moves a file or a whole folder, across drives if it has to. */
export const movePath = async (from: string, to: string): Promise<void> => {
  if (await pathExists(to)) {
    const stat = await fs.stat(from);
    if (!stat.isDirectory()) {
      await moveFile(from, to);
      return;
    }
    await fs.mkdir(to, { recursive: true });
    for (const name of await fs.readdir(from)) {
      await movePath(join(from, name), join(to, name));
    }
    await fs.rmdir(from).catch(() => undefined);
    return;
  }

  await fs.mkdir(dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
};

export const pathExists = (path: string): Promise<boolean> =>
  fs
    .access(path)
    .then(() => true)
    .catch(() => false);

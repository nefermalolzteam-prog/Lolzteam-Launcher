import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store is the one module here that talks to Electron; everything it needs is `userData`.
const userData = mkdtempSync(join(tmpdir(), 'lzt-local-accounts-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  createLocalAccount,
  deleteLocalAccount,
  forgetLocalDbBase,
  getLocalAccount,
  getLocalStoreDir,
  listLocalAccountFolders,
  listLocalAccounts,
  listLocalDbBases,
  listLocalGroups,
  localAccountFolders,
  moveLocalAccountToGroup,
  resetLocalAccountsStoreForTests,
  setLocalAccountLabels,
  switchLocalStoreTo,
  updateLocalAccount,
} = await import('../local-store');

const { setSettings } = await import('../../settings/settings-store');

const root = join(userData, 'accounts');
const steamDir = join(root, 'steam');
const telegramDir = join(root, 'telegram');
const legacyFile = join(userData, 'local-accounts.json');

const steamValue = {
  service: 'steam',
  label: 'Main',
  login: 'user01',
  password: 'secret',
  sharedSecret: null,
  identitySecret: null,
  deviceId: null,
} as const;

// A Telegram account is filed under its user id — see `folderName` in `db-paths`.
const TG_DIR = '5';

const telegramValue = {
  service: 'telegram',
  label: 'Work',
  authKey: 'a1'.repeat(256),
  dcId: 2,
  phone: '+79001234567',
  userId: 5,
} as const;

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(path, 'utf8'));

const ls = async (dir: string): Promise<string[]> =>
  fs.readdir(dir).then(
    (names) => names.sort(),
    () => [],
  );

/** Writes an account folder the way a user copying one in would. */
const dropFolder = async (dir: string, record: Record<string, unknown>): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'account.json'), JSON.stringify(record), 'utf8');
};

const clean = async (): Promise<void> => {
  for (const name of await fs.readdir(userData)) {
    await fs.rm(join(userData, name), { force: true, recursive: true });
  }
  // The base folder is a setting, and the settings store keeps its own cache.
  await setSettings({ localDbDir: null, localDbDirs: [] });
  resetLocalAccountsStoreForTests();
};

beforeEach(clean);
afterEach(clean);

describe('local-store', () => {
  it('starts empty when nothing has been written yet', async () => {
    expect(await listLocalAccounts()).toEqual([]);
  });

  it('gives each account a folder of its own, holding a readable record', async () => {
    expect(await createLocalAccount(steamValue)).toEqual({ ok: true, id: -1 });
    expect(await createLocalAccount(telegramValue)).toEqual({ ok: true, id: -2 });

    expect(await ls(steamDir)).toEqual(['Main']);
    // Named after the id, not after «Work» — the label it wears in the list.
    expect(await ls(telegramDir)).toEqual([TG_DIR]);
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json']);
    // No decryption step: the file is the record.
    expect(await readJson(join(steamDir, 'Main', 'account.json'))).toMatchObject({
      id: -1,
      service: 'steam',
      label: 'Main',
      login: 'user01',
      password: 'secret',
    });
  });

  it('reads the folders back after a restart', async () => {
    await createLocalAccount(steamValue);
    await createLocalAccount(telegramValue);

    resetLocalAccountsStoreForTests();
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);
    expect(await getLocalAccount(-2)).toMatchObject({ service: 'telegram', dcId: 2 });
  });

  it('reuses the id of a deleted account', async () => {
    await createLocalAccount(steamValue);
    await createLocalAccount(telegramValue);
    expect(await deleteLocalAccount(-2)).toEqual({ ok: true, id: -2 });
    expect(await ls(telegramDir)).toEqual([]);

    resetLocalAccountsStoreForTests();
    expect(await createLocalAccount(telegramValue)).toEqual({ ok: true, id: -2 });
  });

  it('takes the sidecars along when the account is deleted', async () => {
    await createLocalAccount(steamValue);
    // Whatever the authenticator left in the folder must not outlive the account.
    await fs.writeFile(join(steamDir, 'Main', 'guard.json'), '{"steamId":"7"}', 'utf8');

    expect(await deleteLocalAccount(-1)).toEqual({ ok: true, id: -1 });
    expect(await ls(steamDir)).toEqual([]);
  });

  it('updates in place, preserving createdAt and refusing a service switch', async () => {
    await createLocalAccount(steamValue);
    const before = await getLocalAccount(-1);

    expect(await updateLocalAccount(-1, { ...steamValue, label: 'Renamed' })).toEqual({
      ok: true,
      id: -1,
    });
    const after = await getLocalAccount(-1);
    expect(after?.label).toBe('Renamed');
    expect(after?.createdAt).toBe(before?.createdAt);
    // The folder follows the label instead of keeping a name nobody recognises.
    expect(await ls(steamDir)).toEqual(['Renamed']);

    expect(await updateLocalAccount(-1, telegramValue)).toEqual({
      ok: false,
      message: 'service_mismatch',
    });
  });

  it('renames the folder without disturbing what is inside it', async () => {
    await createLocalAccount(steamValue);
    await fs.writeFile(join(steamDir, 'Main', 'guard.json'), '{"steamId":"7"}', 'utf8');

    await updateLocalAccount(-1, { ...steamValue, label: 'Renamed' });
    expect(await ls(join(steamDir, 'Renamed'))).toEqual(['account.json', 'guard.json']);
  });

  it('reports a missing id instead of creating one', async () => {
    expect(await updateLocalAccount(-9, steamValue)).toEqual({ ok: false, message: 'not_found' });
    expect(await deleteLocalAccount(-9)).toEqual({ ok: false, message: 'not_found' });
  });

  it('turns a label into a folder name Windows accepts', async () => {
    await createLocalAccount({ ...steamValue, label: 'Main/Sub: "one"?' });
    await createLocalAccount({ ...steamValue, label: 'CON' });
    await createLocalAccount({ ...steamValue, label: 'trailing dot.' });
    await createLocalAccount({ ...steamValue, label: '///' });
    // `_market` is the shelf for accounts that have no folder; a label cannot take it over.
    await createLocalAccount({ ...steamValue, label: '_market' });

    expect(await ls(steamDir)).toEqual([
      'Main Sub one',
      '_CON',
      '__market',
      'account',
      'trailing dot',
    ]);
  });

  it('numbers folders when two accounts share a label', async () => {
    await createLocalAccount(steamValue);
    await createLocalAccount(steamValue);
    expect(await ls(steamDir)).toEqual(['Main', 'Main (2)']);
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);
  });

  it('leaves no temporary file behind', async () => {
    await createLocalAccount(steamValue);
    await updateLocalAccount(-1, { ...steamValue, login: 'user02' });
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json']);
  });

  it('serialises concurrent writes instead of losing one', async () => {
    await Promise.all([
      createLocalAccount(steamValue),
      createLocalAccount(telegramValue),
      createLocalAccount(steamValue),
    ]);
    resetLocalAccountsStoreForTests();
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2, -3]);
  });

  it('skips a folder it cannot parse without touching it or blocking the rest', async () => {
    await createLocalAccount(steamValue);
    await fs.mkdir(join(steamDir, 'broken'), { recursive: true });
    await fs.writeFile(join(steamDir, 'broken', 'account.json'), 'not json at all', 'utf8');
    // Present but incomplete: a password is not optional for a steam account.
    await dropFolder(join(steamDir, 'partial'), { id: -7, label: 'partial', login: 'x' });
    resetLocalAccountsStoreForTests();

    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1]);
    // One bad folder used to freeze every write; now it costs exactly itself.
    expect(await createLocalAccount(telegramValue)).toEqual({ ok: true, id: -2 });
    expect(await fs.readFile(join(steamDir, 'broken', 'account.json'), 'utf8')).toBe(
      'not json at all',
    );
  });

  it('adopts a folder dropped into the base by hand', async () => {
    await dropFolder(join(telegramDir, 'Dropped'), {
      label: 'Dropped',
      authKey: 'ff'.repeat(256),
      dcId: 4,
    });

    const [record] = await listLocalAccounts();
    expect(record).toMatchObject({ id: -1, service: 'telegram', label: 'Dropped', dcId: 4 });
    // The id it was given is written back, so it is stable from now on.
    expect(await readJson(join(telegramDir, 'Dropped', 'account.json'))).toMatchObject({ id: -1 });
  });

  it('takes the service from the folder, not from the file', async () => {
    // A folder copied out of `telegram/` and into `steam/` is a steam account now.
    await dropFolder(join(steamDir, 'Confused'), {
      id: -1,
      service: 'telegram',
      label: 'Confused',
      login: 'user01',
      password: 'secret',
    });
    expect(await listLocalAccounts()).toMatchObject([{ id: -1, service: 'steam' }]);
  });

  it('gives a duplicated id to only one of the two folders', async () => {
    for (const name of ['a', 'b']) {
      await dropFolder(join(telegramDir, name), {
        id: -1,
        label: name,
        authKey: '0f'.repeat(256),
        dcId: 1,
      });
    }
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);
  });

  it('sees the folders the user sorted the base into', async () => {
    await dropFolder(join(telegramDir, 'Работа', 'Acc'), {
      id: -1,
      label: 'Acc',
      authKey: '0f'.repeat(256),
      dcId: 1,
    });

    expect(await listLocalAccounts()).toMatchObject([{ id: -1, label: 'Acc' }]);
    expect(await listLocalGroups()).toMatchObject({ telegram: ['Работа'] });
    expect(await listLocalAccountFolders()).toMatchObject([{ id: -1, group: 'Работа' }]);
  });

  // Labels are set as a whole set, not toggled one at a time: the modal knows what the account should wear.
  it('writes the label ids the caller sends and keeps only the sane ones', async () => {
    await createLocalAccount(telegramValue);

    expect(await setLocalAccountLabels(-1, [-2, -5])).toEqual({ ok: true, id: -1 });
    expect((await getLocalAccount(-1))?.labels).toEqual([-2, -5]);

    // A market tag id (positive) is not a label of ours, and a repeat is noise.
    expect(await setLocalAccountLabels(-1, [-3, -3, 2, 0])).toEqual({ ok: true, id: -1 });
    expect((await getLocalAccount(-1))?.labels).toEqual([-3]);

    // Clearing is the same call with nothing in it, and it survives a restart.
    expect(await setLocalAccountLabels(-1, [])).toEqual({ ok: true, id: -1 });
    resetLocalAccountsStoreForTests();
    expect((await getLocalAccount(-1))?.labels).toEqual([]);
  });

  it('refuses to label an account that is not there', async () => {
    expect(await setLocalAccountLabels(-9, [-1])).toEqual({ ok: false, message: 'not_found' });
  });

  it('moves an account between folders by moving the folder', async () => {
    await createLocalAccount(telegramValue);
    await fs.writeFile(join(telegramDir, TG_DIR, 'profile.json'), '{"status":"alive"}', 'utf8');

    expect(await moveLocalAccountToGroup(-1, ' Продажа / ')).toEqual({ ok: true, id: -1 });
    expect(await ls(telegramDir)).toEqual(['Продажа']);
    // Everything the account owns travelled with it, because it is all inside.
    expect(await ls(join(telegramDir, 'Продажа', TG_DIR))).toEqual([
      'account.json',
      'profile.json',
    ]);

    resetLocalAccountsStoreForTests();
    expect(await listLocalAccountFolders()).toMatchObject([{ id: -1, group: 'Продажа' }]);

    expect(await moveLocalAccountToGroup(-1, '')).toEqual({ ok: true, id: -1 });
    expect(await ls(telegramDir)).toEqual([TG_DIR, 'Продажа']);
  });

  // A user folder is a name too.
  it('never gives an account the name of a user folder', async () => {
    await createLocalAccount(telegramValue);
    expect(await moveLocalAccountToGroup(-1, 'Продажа')).toEqual({ ok: true, id: -1 });

    // A key pasted without its id is the case where the label still decides the folder name.
    const pasted = { ...telegramValue, label: 'Продажа', userId: null } as const;
    expect(await createLocalAccount(pasted)).toEqual({
      ok: true,
      id: -2,
    });

    expect(await ls(telegramDir)).toEqual(['Продажа', 'Продажа (2)']);
    // The folder is still a folder, and the account inside it is still listed.
    expect(await ls(join(telegramDir, 'Продажа'))).toEqual([TG_DIR]);
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);

    // And the same after a restart, when the names come from the scan.
    resetLocalAccountsStoreForTests();
    expect(await createLocalAccount(pasted)).toEqual({
      ok: true,
      id: -3,
    });
    expect(await ls(telegramDir)).toEqual(['Продажа', 'Продажа (2)', 'Продажа (3)']);
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2, -3]);
  });

  // Moving into a folder drops the cached scan.
  it('still notices a folder dropped in by hand after a move', async () => {
    await createLocalAccount(telegramValue);
    expect(await moveLocalAccountToGroup(-1, 'Продажа')).toEqual({ ok: true, id: -1 });

    await dropFolder(join(telegramDir, 'Dropped'), {
      ...telegramValue,
      id: -7,
      createdAt: 1,
      updatedAt: 1,
    });

    expect((await listLocalAccounts()).map((a) => a.id).sort((a, b) => a - b)).toEqual([-7, -1]);
  });

  it('converts the previous flat layout into folders, sidecars included', async () => {
    await fs.mkdir(steamDir, { recursive: true });
    await fs.mkdir(telegramDir, { recursive: true });
    const now = Date.now();
    await fs.writeFile(
      join(steamDir, 'Main.json'),
      JSON.stringify({ ...steamValue, id: -1, createdAt: now, updatedAt: now }),
      'utf8',
    );
    // Guard files were named after the Steam login, never after the label.
    await fs.writeFile(
      join(steamDir, 'user01.guard.json'),
      JSON.stringify({ accountId: -1, steamId: '7', refreshToken: 't', deviceId: 'android:x' }),
      'utf8',
    );
    // A market account has no folder in the base at all.
    await fs.writeFile(
      join(steamDir, 'market01.guard.json'),
      JSON.stringify({ accountId: 555, steamId: '9', refreshToken: 't', deviceId: 'android:y' }),
      'utf8',
    );
    await fs.writeFile(
      join(telegramDir, 'Work.json'),
      JSON.stringify({ ...telegramValue, id: -2, createdAt: now, updatedAt: now }),
      'utf8',
    );
    await fs.writeFile(
      join(telegramDir, '+79001234567.profile.json'),
      JSON.stringify({ accountId: -2, status: 'alive', name: 'Ann' }),
      'utf8',
    );
    await fs.writeFile(join(telegramDir, '+79001234567.avatar.jpg'), 'jpeg', 'utf8');

    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);
    expect(await ls(steamDir)).toEqual(['Main', '_market']);
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json', 'guard.json']);
    expect(await ls(join(steamDir, '_market', '555'))).toEqual(['guard.json']);
    expect(await ls(join(telegramDir, TG_DIR))).toEqual([
      'account.json',
      'avatar.jpg',
      'profile.json',
    ]);

    // Nothing left loose, and a second pass finds nothing to do.
    resetLocalAccountsStoreForTests();
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);
    expect(await ls(steamDir)).toEqual(['Main', '_market']);
  });

  it('migrates the old single encrypted file, once', async () => {
    const now = Date.now();
    await fs.writeFile(
      legacyFile,
      JSON.stringify({
        version: 1,
        nextId: -3,
        accounts: [
          { ...steamValue, id: -1, createdAt: now, updatedAt: now },
          { ...telegramValue, id: -2, createdAt: now, updatedAt: now },
        ],
      }),
      'utf8',
    );

    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);
    expect(await ls(steamDir)).toEqual(['Main']);
    expect(await ls(telegramDir)).toEqual([TG_DIR]);
    // Renamed, never deleted.
    const left = await ls(userData);
    expect(left.some((n) => n.startsWith('local-accounts.json.migrated-'))).toBe(true);
    expect(left).not.toContain('local-accounts.json');

    resetLocalAccountsStoreForTests();
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1, -2]);
  });

  it('keeps an unreadable legacy file instead of guessing at it', async () => {
    await fs.writeFile(legacyFile, 'garbage', 'utf8');
    expect(await listLocalAccounts()).toEqual([]);
    expect(await ls(userData)).toContain('local-accounts.json');
  });

  // The app opens by asking for the list, the folders and the groups at once.
  it('imports the legacy file once, however many readers arrive together', async () => {
    const now = Date.now();
    await fs.writeFile(
      legacyFile,
      JSON.stringify({
        version: 1,
        nextId: -3,
        accounts: [
          { ...steamValue, id: -1, createdAt: now, updatedAt: now },
          { ...telegramValue, id: -2, createdAt: now, updatedAt: now },
        ],
      }),
      'utf8',
    );

    const [accounts, folders, groups] = await Promise.all([
      listLocalAccounts(),
      listLocalAccountFolders(),
      listLocalGroups(),
    ]);

    expect(accounts.map((a) => a.id)).toEqual([-1, -2]);
    expect(folders).toHaveLength(2);
    expect(groups.steam).toEqual([]);
    expect(await ls(steamDir)).toEqual(['Main']);
    expect(await ls(telegramDir)).toEqual([TG_DIR]);
  });

  // The generation is what tells a sidecar store its cache is still about this base.
  it('gives the folders and the generation from the same scan', async () => {
    await createLocalAccount(steamValue);
    resetLocalAccountsStoreForTests();

    const [first, second] = await Promise.all([localAccountFolders(), localAccountFolders()]);

    expect(first.generation).toBe(second.generation);
    expect(first.folders).toEqual(second.folders);
  });

  // A create in flight and a read arriving mid-write: the read used to rescan straight through it.
  it('does not let a read rescan through a write', async () => {
    const created = createLocalAccount(steamValue);
    const listed = listLocalAccounts();
    const [result, before] = await Promise.all([created, listed]);

    expect(result.ok).toBe(true);
    // Whichever of the two the queue ran first, the account is in the list by the time the next reader asks.
    expect((await listLocalAccounts()).map((a) => a.label)).toEqual(['Main']);
    expect(before.length).toBeLessThanOrEqual(1);
  });
});

/** Switching bases, which is deliberately not the same thing as moving one. */
describe('local-store bases', () => {
  /** A second base, inside `userData` only so `clean` sweeps it up. */
  const other = join(userData, 'stick');

  it('reads another base without moving a single file', async () => {
    await createLocalAccount(steamValue);
    await fs.mkdir(other, { recursive: true });

    expect(await switchLocalStoreTo(other)).toEqual({ ok: true, dir: other });
    expect(await listLocalAccounts()).toEqual([]);
    // The base that was left behind is untouched — this is not a move.
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json']);

    // Ids are per-base: the first account of this one starts over at -1.
    expect(await createLocalAccount(telegramValue)).toEqual({ ok: true, id: -1 });
    expect(await ls(join(other, 'telegram'))).toEqual([TG_DIR]);

    expect(await switchLocalStoreTo(null)).toEqual({ ok: true, dir: null });
    expect((await listLocalAccounts()).map((a) => a.label)).toEqual(['Main']);
  });

  // A base on a stick that is not plugged in must not be created.
  it('refuses a base folder that is not there', async () => {
    await createLocalAccount(steamValue);
    const gone = join(userData, 'unplugged');

    expect(await switchLocalStoreTo(gone)).toEqual({ ok: false, reason: 'missing' });
    expect(await getLocalStoreDir()).toBe(root);
    expect((await listLocalAccounts()).map((a) => a.label)).toEqual(['Main']);
    expect(await ls(gone)).toEqual([]);
  });

  it('lists every base it has opened, with what each one holds', async () => {
    await createLocalAccount(steamValue);
    await fs.mkdir(other, { recursive: true });
    await switchLocalStoreTo(other);
    await createLocalAccount(telegramValue);

    const bases = await listLocalDbBases();

    // The app's own folder always leads the list, whatever has been opened since.
    expect(bases.map((b) => b.dir)).toEqual([null, other]);
    expect(bases[0]).toMatchObject({
      current: false,
      available: true,
      counts: { steam: 1, telegram: 0 },
    });
    expect(bases[1]).toMatchObject({
      current: true,
      available: true,
      counts: { steam: 0, telegram: 1 },
    });
  });

  it('says so when a base folder has gone', async () => {
    await fs.mkdir(other, { recursive: true });
    await switchLocalStoreTo(other);
    await switchLocalStoreTo(null);
    await fs.rm(other, { force: true, recursive: true });

    expect((await listLocalDbBases()).find((b) => b.dir === other)).toMatchObject({
      available: false,
      counts: null,
    });
  });

  it('forgets a base without touching the folder', async () => {
    await fs.mkdir(other, { recursive: true });
    await switchLocalStoreTo(other);
    await createLocalAccount(telegramValue);
    await switchLocalStoreTo(null);

    expect((await forgetLocalDbBase(other)).map((b) => b.dir)).toEqual([null]);
    expect(await ls(join(other, 'telegram'))).toEqual([TG_DIR]);
  });

  // Forgetting the base being read would leave the switcher with no row for it, and no way back to it either.
  it('keeps the base it is reading in the list', async () => {
    await fs.mkdir(other, { recursive: true });
    await switchLocalStoreTo(other);

    expect((await forgetLocalDbBase(other)).map((b) => b.dir)).toEqual([null, other]);
  });
});

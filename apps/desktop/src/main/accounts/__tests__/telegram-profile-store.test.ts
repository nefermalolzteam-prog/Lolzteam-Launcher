import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TelegramCheckInfo } from '@shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same Electron surface the account store needs: `userData` and nothing else.
const userData = mkdtempSync(join(tmpdir(), 'lzt-tg-profiles-'));

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
  deleteTelegramProfile,
  getTelegramProfile,
  listTelegramProfiles,
  readTelegramAvatar,
  resetTelegramProfileStoreForTests,
  saveTelegramProfile,
} = await import('../telegram-profile-store');

const { createLocalAccount, listLocalAccounts, resetLocalAccountsStoreForTests } = await import(
  '../local-store'
);

const telegramDir = join(userData, 'accounts', 'telegram');
// A Telegram account's folder is named after its user id rather than its label — see `folderName` in `db-paths`.
const workDir = join(telegramDir, '5');

const telegramValue = {
  service: 'telegram',
  label: 'Work',
  authKey: 'a1'.repeat(256),
  dcId: 2,
  phone: '+79001234567',
  userId: 5,
} as const;

const info = (over: Partial<TelegramCheckInfo> = {}): TelegramCheckInfo => ({
  status: 'alive',
  userId: 777,
  phone: '+79001234567',
  username: 'durov',
  name: 'Pavel',
  premium: true,
  country: 'RU',
  spam: { status: 'free', until: null },
  sessions: 3,
  detail: null,
  ...over,
});

const ls = async (dir: string): Promise<string[]> =>
  fs.readdir(dir).then(
    (names) => names.sort(),
    () => [],
  );

/** The account the sidecars in most of these tests belong to. */
const account = async (): Promise<void> => {
  expect(await createLocalAccount(telegramValue)).toEqual({ ok: true, id: -1 });
};

const clean = async (): Promise<void> => {
  for (const name of await fs.readdir(userData)) {
    await fs.rm(join(userData, name), { force: true, recursive: true });
  }
  resetTelegramProfileStoreForTests();
  resetLocalAccountsStoreForTests();
};

beforeEach(clean);
afterEach(clean);

describe('telegram-profile-store', () => {
  it('starts empty', async () => {
    expect(await listTelegramProfiles()).toEqual([]);
    expect(await getTelegramProfile(-1)).toBeNull();
  });

  it('writes a readable record into the account folder', async () => {
    await account();
    expect(await saveTelegramProfile(-1, info(), null)).toBe(true);

    expect(await ls(workDir)).toEqual(['account.json', 'profile.json']);
    const raw = JSON.parse(await fs.readFile(join(workDir, 'profile.json'), 'utf8'));
    expect(raw).toMatchObject({
      accountId: -1,
      status: 'alive',
      name: 'Pavel',
      username: 'durov',
      country: 'RU',
      premium: true,
      sessions: 3,
    });
    expect(typeof raw.checkedAt).toBe('number');

    const [profile] = await listTelegramProfiles();
    expect(profile).toMatchObject({ accountId: -1, country: 'RU', hasAvatar: false });
  });

  it('stores the avatar beside the record and reads it back as a data URL', async () => {
    await account();
    await saveTelegramProfile(-1, info(), new Uint8Array([1, 2, 3]));

    expect(await ls(workDir)).toEqual(['account.json', 'avatar.jpg', 'profile.json']);
    expect((await getTelegramProfile(-1))?.hasAvatar).toBe(true);
    expect(await readTelegramAvatar(-1)).toBe(`data:image/jpeg;base64,${btoa('\x01\x02\x03')}`);
  });

  it('keeps the last picture when a check never got as far as looking', async () => {
    await account();
    await saveTelegramProfile(-1, info(), new Uint8Array([1]));
    // `undefined` — a dead key or a flood wait.
    await saveTelegramProfile(
      -1,
      info({ status: 'dead', detail: 'AUTH_KEY_UNREGISTERED' }),
      undefined,
    );

    expect((await getTelegramProfile(-1))?.hasAvatar).toBe(true);
    expect(await readTelegramAvatar(-1)).not.toBeNull();
  });

  it('drops the picture when the check looked and found none', async () => {
    await account();
    await saveTelegramProfile(-1, info(), new Uint8Array([1]));
    await saveTelegramProfile(-1, info(), null);

    expect(await ls(workDir)).toEqual(['account.json', 'profile.json']);
    expect((await getTelegramProfile(-1))?.hasAvatar).toBe(false);
    expect(await readTelegramAvatar(-1)).toBeNull();
  });

  it('follows the account when its folder is renamed', async () => {
    const { updateLocalAccount } = await import('../local-store');
    await account();
    await saveTelegramProfile(-1, info(), new Uint8Array([9]));

    // The user id is what a Telegram folder is named after.
    await updateLocalAccount(-1, { ...telegramValue, userId: 9 });
    resetTelegramProfileStoreForTests();

    expect(await ls(join(telegramDir, '9'))).toEqual([
      'account.json',
      'avatar.jpg',
      'profile.json',
    ]);
    expect(await readTelegramAvatar(-1)).toBe(`data:image/jpeg;base64,${btoa('\x09')}`);
  });

  it('removes both files, and leaves the account', async () => {
    await account();
    await saveTelegramProfile(-1, info(), new Uint8Array([1]));
    expect(await deleteTelegramProfile(-1)).toBe(true);

    expect(await ls(workDir)).toEqual(['account.json']);
    expect(await getTelegramProfile(-1)).toBeNull();
    // Removing what is not there is not an error — the caller deletes blindly.
    expect(await deleteTelegramProfile(-1)).toBe(true);
  });

  it('skips a record it cannot parse and never overwrites it', async () => {
    await account();
    await fs.mkdir(join(telegramDir, 'Bad'), { recursive: true });
    await fs.writeFile(
      join(telegramDir, 'Bad', 'account.json'),
      JSON.stringify({ id: -2, label: 'Bad', authKey: 'ff'.repeat(256), dcId: 1 }),
      'utf8',
    );
    await fs.writeFile(join(telegramDir, 'Bad', 'profile.json'), '{ not json', 'utf8');
    // Parsed, but the status is not one the list can draw.
    await fs.mkdir(join(telegramDir, 'Half'), { recursive: true });
    await fs.writeFile(
      join(telegramDir, 'Half', 'account.json'),
      JSON.stringify({ id: -3, label: 'Half', authKey: 'ee'.repeat(256), dcId: 1 }),
      'utf8',
    );
    await fs.writeFile(join(telegramDir, 'Half', 'profile.json'), '{"accountId": -9}', 'utf8');

    await saveTelegramProfile(-1, info(), null);

    expect((await listTelegramProfiles()).map((p) => p.accountId)).toEqual([-1]);
    expect(await fs.readFile(join(telegramDir, 'Bad', 'profile.json'), 'utf8')).toBe('{ not json');
    expect(await fs.readFile(join(telegramDir, 'Half', 'profile.json'), 'utf8')).toBe(
      '{"accountId": -9}',
    );
  });

  // The file it was asked to replace is the only copy of what a check found.
  it('refuses to write over its own unreadable record', async () => {
    await account();
    await fs.writeFile(join(workDir, 'profile.json'), '{ half a file', 'utf8');
    resetTelegramProfileStoreForTests();

    expect(await saveTelegramProfile(-1, info(), null)).toBe(false);
    expect(await fs.readFile(join(workDir, 'profile.json'), 'utf8')).toBe('{ half a file');
    // Deleting it is still allowed: that one the user asked for.
    expect(await deleteTelegramProfile(-1)).toBe(true);
    expect(await ls(workDir)).toEqual(['account.json']);
    expect(await saveTelegramProfile(-1, info(), null)).toBe(true);
  });

  // Ids are handed out again after a delete, so a shelf named after a local id would be inherited by the next account.
  it('never shelves a hand-added account that has no folder', async () => {
    const { deleteLocalAccount } = await import('../local-store');
    await account();
    await deleteLocalAccount(-1);

    expect(await saveTelegramProfile(-1, info(), null)).toBe(false);
    expect(await ls(join(telegramDir, '_market'))).toEqual([]);
    expect(await getTelegramProfile(-1)).toBeNull();
  });

  it('takes the id from the folder, not from the flag in the file', async () => {
    await account();
    // A record copied from another database: it carries someone else's id and claims a picture that did not travel with it.
    await fs.writeFile(
      join(workDir, 'profile.json'),
      JSON.stringify({ accountId: -44, status: 'alive', name: 'Copied', hasAvatar: true }),
      'utf8',
    );
    resetTelegramProfileStoreForTests();

    expect(await getTelegramProfile(-1)).toMatchObject({ name: 'Copied', hasAvatar: false });
    expect(await getTelegramProfile(-44)).toBeNull();
    expect(await readTelegramAvatar(-1)).toBeNull();
  });

  it('notices a picture dropped into the folder by hand', async () => {
    await account();
    await saveTelegramProfile(-1, info(), null);
    await fs.writeFile(join(workDir, 'avatar.jpg'), Buffer.from([7]));
    resetTelegramProfileStoreForTests();

    expect((await getTelegramProfile(-1))?.hasAvatar).toBe(true);
  });

  it('shelves a market account, and stays invisible to the account scanner', async () => {
    await account();
    await saveTelegramProfile(-1, info(), new Uint8Array([1]));
    await saveTelegramProfile(555, info({ phone: null }), null);

    expect(await ls(join(telegramDir, '_market', '555'))).toEqual(['profile.json']);
    expect((await listTelegramProfiles()).map((p) => p.accountId).sort()).toEqual([-1, 555]);

    resetLocalAccountsStoreForTests();
    expect((await listLocalAccounts()).map((a) => a.id)).toEqual([-1]);
  });
});

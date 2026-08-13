import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'lzt-steam-guard-'));

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
  deleteGuardRecord,
  getGuardRecord,
  listGuardRecords,
  resetGuardStoreForTests,
  saveGuardRecord,
} = await import('../session-store');
const { onGuardRecordDropped } = await import('../cache-events');
const { createLocalAccount, listLocalAccounts, resetLocalAccountsStoreForTests } = await import(
  '../../../accounts/local-store'
);

const steamDir = join(userData, 'accounts', 'steam');
const legacyFile = join(userData, 'steam-guard.json');

const record = {
  accountId: -1,
  steamId: '76561198000000001',
  accountName: 'user01',
  refreshToken: 'token-a',
  sharedSecret: 'shared',
  identitySecret: 'identity',
  deviceId: 'android:1111',
  proxyId: null,
} as const;

const steamValue = {
  service: 'steam',
  label: 'Main',
  login: 'user01',
  password: 'secret',
  sharedSecret: null,
  identitySecret: null,
  deviceId: null,
} as const;

const ls = async (dir: string): Promise<string[]> =>
  fs.readdir(dir).then(
    (names) => names.sort(),
    () => [],
  );

const clean = async (): Promise<void> => {
  for (const name of await fs.readdir(userData)) {
    await fs.rm(join(userData, name), { force: true, recursive: true });
  }
  resetGuardStoreForTests();
  resetLocalAccountsStoreForTests();
};

beforeEach(clean);
afterEach(clean);

describe('steam-guard session-store', () => {
  // Access tokens and web cookies are held in memory by account id and are not this store's to clear.
  it('announces a record that is no longer the one in memory', async () => {
    const dropped: number[] = [];
    onGuardRecordDropped((id) => dropped.push(id));
    await createLocalAccount(steamValue);

    await saveGuardRecord(record);
    await saveGuardRecord({ ...record, refreshToken: 'token-b' });
    await deleteGuardRecord(-1);
    // Nothing left to remove, but the caller still asked for it gone.
    await deleteGuardRecord(-1);

    expect(dropped).toEqual([-1, -1, -1, -1]);
  });

  it('writes the secrets into the account folder they belong to', async () => {
    await createLocalAccount(steamValue);
    expect(await saveGuardRecord(record)).toBe(true);
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json', 'guard.json']);

    const raw = JSON.parse(await fs.readFile(join(steamDir, 'Main', 'guard.json'), 'utf8'));
    expect(raw).toMatchObject({ accountId: -1, refreshToken: 'token-a', deviceId: 'android:1111' });
  });

  it('reads the folder back after a restart', async () => {
    await createLocalAccount(steamValue);
    await saveGuardRecord(record);
    resetGuardStoreForTests();

    expect(await getGuardRecord(-1)).toMatchObject({ steamId: record.steamId });
    expect(await listGuardRecords()).toHaveLength(1);
  });

  it('follows the account when its folder is renamed', async () => {
    const { updateLocalAccount } = await import('../../../accounts/local-store');
    await createLocalAccount(steamValue);
    await saveGuardRecord(record);

    await updateLocalAccount(-1, { ...steamValue, label: 'Renamed' });
    resetGuardStoreForTests();
    expect(await getGuardRecord(-1)).toMatchObject({ refreshToken: 'token-a' });
    expect(await ls(join(steamDir, 'Renamed'))).toEqual(['account.json', 'guard.json']);
  });

  it('replaces in place, preserving createdAt', async () => {
    await createLocalAccount(steamValue);
    await saveGuardRecord(record);
    const before = await getGuardRecord(-1);
    await saveGuardRecord({ ...record, refreshToken: 'token-b' });

    const after = await getGuardRecord(-1);
    expect(after?.refreshToken).toBe('token-b');
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json', 'guard.json']);
  });

  it('deletes the secrets and leaves the account alone', async () => {
    await createLocalAccount(steamValue);
    await saveGuardRecord(record);
    expect(await deleteGuardRecord(-1)).toBe(true);
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json']);
    expect(await getGuardRecord(-1)).toBeNull();
  });

  it('shelves a market account, which has no folder of its own', async () => {
    const market = { ...record, accountId: 42, accountName: 'market01' };
    expect(await saveGuardRecord(market)).toBe(true);
    expect(await ls(join(steamDir, '_market', '42'))).toEqual(['guard.json']);

    resetGuardStoreForTests();
    expect(await getGuardRecord(42)).toMatchObject({ accountName: 'market01' });
    // The shelf is not the base: no account was invented out of it.
    resetLocalAccountsStoreForTests();
    expect(await listLocalAccounts()).toEqual([]);

    expect(await deleteGuardRecord(42)).toBe(true);
    expect(await ls(join(steamDir, '_market'))).toEqual([]);
  });

  it('takes the id from the folder, not from the file', async () => {
    // A folder carried over from another base names the account it landed in.
    await createLocalAccount(steamValue);
    await fs.writeFile(
      join(steamDir, 'Main', 'guard.json'),
      JSON.stringify({ ...record, accountId: -99 }),
      'utf8',
    );
    resetGuardStoreForTests();
    expect(await getGuardRecord(-1)).toMatchObject({ accountId: -1, steamId: record.steamId });
    expect(await getGuardRecord(-99)).toBeNull();
  });

  it('migrates the old encrypted file, once', async () => {
    await createLocalAccount(steamValue);
    const now = Date.now();
    await fs.writeFile(
      legacyFile,
      JSON.stringify({
        version: 1,
        records: [
          { ...record, createdAt: now, updatedAt: now },
          {
            ...record,
            accountId: 42,
            accountName: 'market01',
            deviceId: 'android:2222',
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
      'utf8',
    );

    expect((await listGuardRecords()).map((r) => r.accountId).sort()).toEqual([-1, 42]);
    expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json', 'guard.json']);
    expect(await ls(join(steamDir, '_market', '42'))).toEqual(['guard.json']);
    const left = await ls(userData);
    expect(left.some((n) => n.startsWith('steam-guard.json.migrated-'))).toBe(true);

    resetGuardStoreForTests();
    expect(await listGuardRecords()).toHaveLength(2);
  });

  // The app opens by asking for the list and for one account's status at the same moment.
  it('finishes the migration before the caller that arrived second', async () => {
    await createLocalAccount(steamValue);
    const now = Date.now();
    await fs.writeFile(
      legacyFile,
      JSON.stringify({ version: 1, records: [{ ...record, createdAt: now, updatedAt: now }] }),
      'utf8',
    );

    const [list, one] = await Promise.all([listGuardRecords(), getGuardRecord(-1)]);
    expect(list).toHaveLength(1);
    expect(one).toMatchObject({ refreshToken: 'token-a' });
  });

  // An authenticator that did not land is still only in the legacy file.
  it('keeps the legacy file when a record had nowhere to go', async () => {
    const now = Date.now();
    await fs.writeFile(
      legacyFile,
      JSON.stringify({ version: 1, records: [{ ...record, createdAt: now, updatedAt: now }] }),
      'utf8',
    );

    // No account folder for -1, and a hand-added id is never shelved under `_market`, so the record has nowhere to be written.
    expect(await listGuardRecords()).toEqual([]);
    expect(await ls(userData)).toContain('steam-guard.json');

    // And it lands on the next start, once the folder is there.
    await createLocalAccount(steamValue);
    resetGuardStoreForTests();
    expect(await getGuardRecord(-1)).toMatchObject({ refreshToken: 'token-a' });
    expect(await ls(userData)).not.toContain('steam-guard.json');
  });

  // `guard.json` is the only copy of `shared_secret` and `identity_secret` there is — Steam will not show them again.
  describe('a record it could not read', () => {
    const damage = async (contents: string): Promise<void> => {
      await createLocalAccount(steamValue);
      await saveGuardRecord(record);
      await fs.writeFile(join(steamDir, 'Main', 'guard.json'), contents, 'utf8');
      resetGuardStoreForTests();
    };

    it('is not overwritten when the JSON is broken', async () => {
      await damage('{ this is not json');

      expect(await getGuardRecord(-1)).toBeNull();
      expect(await saveGuardRecord({ ...record, refreshToken: 'token-b' })).toBe(false);
      expect(await fs.readFile(join(steamDir, 'Main', 'guard.json'), 'utf8')).toBe(
        '{ this is not json',
      );
    });

    it('is not overwritten when a secret is missing from it', async () => {
      // Parses as JSON, so only `parse` can catch it — and the half a record that is left may still be the half that matters.
      const partial = JSON.stringify({ accountId: -1, steamId: record.steamId });
      await damage(partial);

      expect(await saveGuardRecord(record)).toBe(false);
      expect(await fs.readFile(join(steamDir, 'Main', 'guard.json'), 'utf8')).toBe(partial);
    });

    it('is still deleted when the user asks for it gone', async () => {
      // Refusing to *overwrite* protects a record the user still wants.
      await damage('{ this is not json');

      expect(await deleteGuardRecord(-1)).toBe(true);
      expect(await ls(join(steamDir, 'Main'))).toEqual(['account.json']);
      // And the bar it put up is gone with it.
      expect(await saveGuardRecord(record)).toBe(true);
    });

    it('does not stop the account next to it from saving', async () => {
      await damage('{ this is not json');
      await createLocalAccount({ ...steamValue, label: 'Second', login: 'user02' });
      const second = (await listLocalAccounts()).find((a) => a.label === 'Second');

      expect(second).toBeDefined();
      expect(await saveGuardRecord({ ...record, accountId: second?.id ?? 0 })).toBe(true);
      expect(await ls(join(steamDir, 'Second'))).toEqual(['account.json', 'guard.json']);
    });
  });
});

import type { LocalAccountRecord, LocalImportFile } from '@shared-types';
import { describe, expect, it } from 'vitest';
import type { ImportedTelegramSession } from '../local-import';
import { buildImportPlan, parseCredentialLine, parseMafiles } from '../local-import';

/** 20 raw bytes once decoded — the size `parseSteamGuard` accepts. */
const SECRET_A = `${'A'.repeat(27)}=`;
const SECRET_B = `${'B'.repeat(27)}=`;
const IDENTITY = `${'C'.repeat(27)}=`;
const DEVICE = 'android:11111111-2222-3333-4444-555555555555';

const mafile = (accountName: string, secret = SECRET_A): LocalImportFile => ({
  name: `${accountName}.maFile`,
  text: JSON.stringify({
    shared_secret: secret,
    identity_secret: IDENTITY,
    device_id: DEVICE,
    account_name: accountName,
  }),
});

const AUTH_KEY_A = 'a'.repeat(512);
const AUTH_KEY_B = 'b'.repeat(512);

const steamRecord = (login: string): LocalAccountRecord => ({
  id: -1,
  service: 'steam',
  label: login,
  login,
  password: 'pw',
  sharedSecret: null,
  identitySecret: null,
  deviceId: null,
  labels: [],
  marketItemId: null,
  createdAt: 0,
  updatedAt: 0,
});

const telegramRecord = (authKey: string): LocalAccountRecord => ({
  id: -2,
  service: 'telegram',
  label: 'tg',
  authKey,
  dcId: 2,
  phone: null,
  userId: null,
  labels: [],
  marketItemId: null,
  createdAt: 0,
  updatedAt: 0,
});

describe('parseCredentialLine', () => {
  it('splits on the first colon, semicolon or space', () => {
    expect(parseCredentialLine('user:pass')).toEqual({ login: 'user', password: 'pass' });
    expect(parseCredentialLine('user;pass')).toEqual({ login: 'user', password: 'pass' });
    expect(parseCredentialLine('user pass')).toEqual({ login: 'user', password: 'pass' });
  });

  it('keeps separators that belong to the password', () => {
    expect(parseCredentialLine('user:pa:ss')).toEqual({ login: 'user', password: 'pa:ss' });
  });

  it('rejects lines with no separator or an empty half', () => {
    expect(parseCredentialLine('useronly')).toBeNull();
    expect(parseCredentialLine('user:')).toBeNull();
    expect(parseCredentialLine(':pass')).toBeNull();
  });
});

describe('parseMafiles', () => {
  it('reads the account name and keeps the file whole', () => {
    const file = mafile('Alice');
    const { parsed, invalid } = parseMafiles([file]);
    expect(invalid).toEqual([]);
    expect(parsed).toEqual([{ accountName: 'Alice', text: file.text, source: 'Alice.maFile' }]);
  });

  it('reports broken JSON and files with no account name', () => {
    const { parsed, invalid } = parseMafiles([
      { name: 'broken.maFile', text: '{ not json' },
      { name: 'nameless.maFile', text: JSON.stringify({ shared_secret: SECRET_A }) },
    ]);
    expect(parsed).toEqual([]);
    expect(invalid.map((r) => r.reason)).toEqual(['no_secret', 'no_account_name']);
  });

  it('keeps the first of two files for the same account', () => {
    const { parsed, invalid } = parseMafiles([mafile('Alice'), mafile('ALICE', SECRET_B)]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.text).toContain(SECRET_A);
    expect(invalid[0]?.reason).toBe('duplicate_input');
  });
});

describe('buildImportPlan (steam)', () => {
  it('matches a maFile to its credentials regardless of case', () => {
    const plan = buildImportPlan(
      { service: 'steam', files: [mafile('Alice')], text: 'alice:secret123' },
      [],
    );
    expect(plan.groups.matched).toEqual([{ title: 'alice', source: 'Alice.maFile' }]);
    expect(plan.matched[0]?.value).toMatchObject({
      service: 'steam',
      login: 'alice',
      password: 'secret123',
      sharedSecret: SECRET_A,
      // The keys confirmations run on come along; a dropped file is the one place they are guaranteed to be present.
      identitySecret: IDENTITY,
      deviceId: DEVICE,
    });
    expect(plan.groups.orphanFiles).toEqual([]);
    expect(plan.groups.missingGuard).toEqual([]);
  });

  it('separates credentials without a maFile from maFiles without credentials', () => {
    const plan = buildImportPlan(
      {
        service: 'steam',
        files: [mafile('Alice'), mafile('Carol', SECRET_B)],
        text: 'alice:a\nbob:b',
      },
      [],
    );
    expect(plan.groups.matched.map((r) => r.title)).toEqual(['alice']);
    expect(plan.groups.missingGuard.map((r) => r.title)).toEqual(['bob']);
    expect(plan.groups.orphanFiles).toEqual([
      { title: 'Carol', source: 'Carol.maFile', reason: 'no_credentials' },
    ]);
    // The guardless one is still prepared — the report only gates it behind a checkbox.
    expect(plan.missingGuard[0]?.value).toMatchObject({ login: 'bob', sharedSecret: null });
  });

  it('leaves accounts that are already stored alone', () => {
    const plan = buildImportPlan({ service: 'steam', files: [mafile('Alice')], text: 'ALICE:a' }, [
      steamRecord('alice'),
    ]);
    expect(plan.matched).toEqual([]);
    expect(plan.groups.duplicates).toEqual([{ title: 'ALICE', reason: 'already_stored' }]);
    expect(plan.groups.orphanFiles).toEqual([
      { title: 'Alice', source: 'Alice.maFile', reason: 'already_stored' },
    ]);
  });

  it('reports a login repeated in the pasted text once', () => {
    const plan = buildImportPlan({ service: 'steam', text: 'bob:one\nBOB:two' }, []);
    expect(plan.missingGuard).toHaveLength(1);
    expect(plan.missingGuard[0]?.value).toMatchObject({ password: 'one' });
    expect(plan.groups.duplicates).toEqual([{ title: 'BOB', reason: 'duplicate_input' }]);
  });

  it('skips blank and commented lines, reports the rest of the junk', () => {
    const plan = buildImportPlan(
      { service: 'steam', text: '\n# a comment\n// another\ngarbage\nbob:b' },
      [],
    );
    expect(plan.groups.invalid).toEqual([{ title: 'garbage', reason: 'bad_line' }]);
    expect(plan.groups.missingGuard.map((r) => r.title)).toEqual(['bob']);
  });
});

describe('buildImportPlan (telegram)', () => {
  it('takes the DC from the key, then from the step default', () => {
    const plan = buildImportPlan(
      { service: 'telegram', text: `${AUTH_KEY_A}:4\n${AUTH_KEY_B}`, defaultDcId: 2 },
      [],
    );
    expect(plan.matched.map((r) => r.value)).toMatchObject([{ dcId: 4 }, { dcId: 2 }]);
    expect(plan.groups.matched.map((r) => r.title)).toEqual(['TG …aaaaaa', 'TG …bbbbbb']);
  });

  it('rejects a key with no DC anywhere', () => {
    const plan = buildImportPlan({ service: 'telegram', text: AUTH_KEY_A }, []);
    expect(plan.matched).toEqual([]);
    expect(plan.groups.invalid).toEqual([{ title: 'TG …aaaaaa', reason: 'invalid_dc' }]);
  });

  it('reports malformed keys and duplicates', () => {
    const plan = buildImportPlan(
      {
        service: 'telegram',
        text: `nonsense\n${AUTH_KEY_A}:1\n${AUTH_KEY_A.toUpperCase()}:1\n${AUTH_KEY_B}:1`,
        defaultDcId: 1,
      },
      [telegramRecord(AUTH_KEY_B)],
    );
    expect(plan.groups.matched.map((r) => r.title)).toEqual(['TG …aaaaaa']);
    expect(plan.groups.invalid).toEqual([{ title: 'nonsense', reason: 'invalid_auth_key' }]);
    expect(plan.groups.duplicates).toEqual([
      { title: 'TG …aaaaaa', reason: 'duplicate_input' },
      { title: 'TG …bbbbbb', reason: 'already_stored' },
    ]);
  });
});

describe('buildImportPlan (telegram, folder)', () => {
  const session = (over: Partial<ImportedTelegramSession> = {}): ImportedTelegramSession => ({
    authKeyHex: AUTH_KEY_A,
    dcId: 2,
    userId: 777,
    phone: '79991234567',
    name: 'tdata',
    ...over,
  });

  it('plans a session read off disk, keeping its source and metadata', () => {
    const plan = buildImportPlan({ service: 'telegram', text: '' }, [], [session()]);
    expect(plan.groups.matched).toEqual([{ title: '+79991234567', source: 'tdata' }]);
    expect(plan.matched.map((r) => r.value)).toMatchObject([
      { dcId: 2, phone: '+79991234567', userId: 777 },
    ]);
  });

  /** A sidecar is only as good as whoever wrote it. */
  it('drops metadata that would not survive the form, not the account', () => {
    const plan = buildImportPlan(
      { service: 'telegram', text: '' },
      [],
      [session({ phone: '123', userId: 0, name: 'bad.session' })],
    );
    expect(plan.groups.matched).toEqual([{ title: 'bad.session', source: 'bad.session' }]);
    expect(plan.matched.map((r) => r.value)).toMatchObject([
      { dcId: 2, phone: null, userId: null },
    ]);
  });

  it('deduplicates a folder session against a pasted key and against the store', () => {
    const plan = buildImportPlan(
      { service: 'telegram', text: `${AUTH_KEY_A}:2\n${AUTH_KEY_B}:2` },
      [telegramRecord(AUTH_KEY_B)],
      [session()],
    );
    // The folder is planned first, so the pasted copy is the duplicate.
    expect(plan.groups.matched).toEqual([{ title: '+79991234567', source: 'tdata' }]);
    expect(plan.groups.duplicates).toEqual([
      { title: 'TG …aaaaaa', reason: 'duplicate_input' },
      { title: 'TG …bbbbbb', reason: 'already_stored' },
    ]);
  });
});

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeConfigVdf, mergeLocalVdf, mergeLoginUsersVdf, writeLocalConfigVdf } from '../vdf';
import { parseVdf } from '../vdf-parse';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lolz-vdf-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const read = async (name: string) => parseVdf(await fs.readFile(join(dir, name), 'utf8'));

// Walks a parsed VDF tree by key. Deliberately self-referential: a VDF value is
// either a nested block or a leaf string, and the assertions below want to read
// both without restating the whole nesting as a type.
interface VdfNode {
  [key: string]: VdfNode;
}
const at = (root: unknown, ...keys: string[]): VdfNode =>
  keys.reduce<unknown>((node, key) => (node as VdfNode | undefined)?.[key], root) as VdfNode;

// Exactly as the Linux client wrote it, `AutoLogin` and all.
const LINUX_LOGINUSERS = `"users"
{
	"76561198000000007"
	{
		"AccountName"		"testaccount"
		"PersonaName"		"TestPersona"
		"RememberPassword"		"1"
		"WantsOfflineMode"		"0"
		"SkipOfflineModeWarning"		"0"
		"AutoLogin"		"1"
		"Timestamp"		"1788086870"
	}
}
`;

describe('mergeLoginUsersVdf', () => {
  it('writes the Windows autologin keys by default', async () => {
    const path = join(dir, 'loginusers.vdf');
    await mergeLoginUsersVdf(path, 'buyer', '76561198000000001');

    const me = at(await read('loginusers.vdf'), 'users', '76561198000000001');
    expect(me.AllowAutoLogin).toBe('1');
    expect(me.MostRecent).toBe('1');
    expect(me.AutoLogin).toBeUndefined();
    expect(me.AccountName).toBe('buyer');
    expect(me.PersonaName).toBe('buyer');
    expect(path).toBeTruthy();
  });

  it('writes the Linux key instead, which is the only one that client reads', async () => {
    await mergeLoginUsersVdf(
      join(dir, 'loginusers.vdf'),
      'buyer',
      '76561198000000001',
      'linux-native',
    );

    const me = at(await read('loginusers.vdf'), 'users', '76561198000000001');
    expect(me.AutoLogin).toBe('1');
    expect(me.AllowAutoLogin).toBeUndefined();
    expect(me.MostRecent).toBeUndefined();
  });

  it('demotes the previously most-recent user on Windows with MostRecent=0', async () => {
    const path = join(dir, 'loginusers.vdf');
    await mergeLoginUsersVdf(path, 'first', '76561198000000001');
    await mergeLoginUsersVdf(path, 'second', '76561198000000002');

    const parsed = await read('loginusers.vdf');
    expect(at(parsed, 'users', '76561198000000001', 'MostRecent')).toBe('0');
    expect(at(parsed, 'users', '76561198000000001', 'AllowAutoLogin')).toBe('1');
    expect(at(parsed, 'users', '76561198000000002', 'MostRecent')).toBe('1');
    expect(at(parsed, 'users', '76561198000000002', 'AllowAutoLogin')).toBe('1');
    // The Windows client never sees the Linux key.
    expect(at(parsed, 'users', '76561198000000001', 'AutoLogin')).toBeUndefined();
  });

  it('demotes the previously auto-logged-in user, per platform', async () => {
    const path = join(dir, 'loginusers.vdf');
    await fs.writeFile(path, LINUX_LOGINUSERS, 'utf8');
    await mergeLoginUsersVdf(path, 'buyer', '76561198000000001', 'linux-native');

    const parsed = await read('loginusers.vdf');
    expect(at(parsed, 'users', '76561198000000007', 'AutoLogin')).toBe('0');
    expect(at(parsed, 'users', '76561198000000001', 'AutoLogin')).toBe('1');
    // The other account survives the merge — it is the user's own Steam login.
    expect(at(parsed, 'users', '76561198000000007', 'AccountName')).toBe('testaccount');
    expect(at(parsed, 'users', '76561198000000007', 'PersonaName')).toBe('TestPersona');
  });

  it('keeps an existing PersonaName rather than replacing it with the login', async () => {
    const path = join(dir, 'loginusers.vdf');
    await fs.writeFile(path, LINUX_LOGINUSERS, 'utf8');
    await mergeLoginUsersVdf(path, 'testaccount', '76561198000000007', 'linux-native');
    expect(at(await read('loginusers.vdf'), 'users', '76561198000000007').PersonaName).toBe(
      'TestPersona',
    );
  });

  it('refuses to overwrite a loginusers.vdf it could not parse', async () => {
    const path = join(dir, 'loginusers.vdf');
    await fs.writeFile(path, 'nonsense', 'utf8');
    await expect(mergeLoginUsersVdf(path, 'buyer', '7')).rejects.toThrow(/could not parse/);
    expect(await fs.readFile(path, 'utf8')).toBe('nonsense');
  });
});

describe('mergeLocalVdf', () => {
  it('adds a ConnectCache entry beside the ones already there', async () => {
    const path = join(dir, 'local.vdf');
    await mergeLocalVdf(path, '579d216c1', 'aabb');
    await mergeLocalVdf(path, 'b98513741', 'ccdd');

    const cache = at(
      await read('local.vdf'),
      'MachineUserConfigStore',
      'Software',
      'Valve',
      'Steam',
      'ConnectCache',
    );
    expect(cache).toEqual({ '579d216c1': 'aabb', b98513741: 'ccdd' });
  });
});

describe('mergeConfigVdf', () => {
  it('records the SteamID under the account name', async () => {
    await mergeConfigVdf(join(dir, 'config.vdf'), 'buyer', '76561198000000001');
    const accounts = at(
      await read('config.vdf'),
      'InstallConfigStore',
      'Software',
      'Valve',
      'Steam',
      'Accounts',
    );
    expect(accounts.buyer).toEqual({ SteamID: '76561198000000001' });
  });
});

describe('writeLocalConfigVdf', () => {
  it('signs out of friends by default', async () => {
    await writeLocalConfigVdf(join(dir, 'localconfig.vdf'));
    const friends = at(await read('localconfig.vdf'), 'UserLocalConfigStore', 'friends');
    expect(friends).toEqual({ SignIntoFriends: '0' });
  });

  it('signs in as invisible when asked', async () => {
    await writeLocalConfigVdf(join(dir, 'localconfig.vdf'), true);
    const friends = at(await read('localconfig.vdf'), 'UserLocalConfigStore', 'friends');
    expect(friends).toEqual({ SignIntoFriends: '1', ePersonaState: '7' });
  });
});

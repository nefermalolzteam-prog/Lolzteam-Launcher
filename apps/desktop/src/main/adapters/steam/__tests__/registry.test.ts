import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linuxNativeLayout, win32Layout } from '../layout';
import { clearAutoLoginUser, setAutoLoginUser } from '../registry';
import { parseVdf } from '../vdf-parse';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lolz-registry-dispatch-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const hkcuSteam = async (path: string) => {
  const root = parseVdf(await fs.readFile(path, 'utf8')) as unknown as {
    Registry: { HKCU: { Software: { Valve: { Steam: Record<string, string> } } } };
  };
  return root.Registry.HKCU.Software.Valve.Steam;
};

describe('setAutoLoginUser / clearAutoLoginUser', () => {
  it('writes registry.vdf when the layout has one', async () => {
    const home = join(dir, 'home');
    const layout = linuxNativeLayout(join(home, '.local', 'share', 'Steam'), home);

    await setAutoLoginUser(layout, 'buyer');
    expect(await hkcuSteam(layout.registryVdfPath!)).toEqual({
      AutoLoginUser: 'buyer',
      RememberPassword: '1',
    });

    await clearAutoLoginUser(layout);
    expect(await hkcuSteam(layout.registryVdfPath!)).toEqual({});
  });

  it('is a no-op for the Windows layout when not on Windows', async () => {
    const layout = win32Layout(join(dir, 'Steam'), join(dir, 'Local'));
    // No `reg.exe` here; the calls must neither throw nor touch the disk.
    await expect(setAutoLoginUser(layout, 'buyer')).resolves.toBeUndefined();
    await expect(clearAutoLoginUser(layout)).resolves.toBeUndefined();
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

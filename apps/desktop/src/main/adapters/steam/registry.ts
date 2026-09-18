import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SteamLayout } from './layout';
import { patchSteamRegistryVdf } from './registry-vdf';

const execFileAsync = promisify(execFile);

const STEAM_KEY = 'HKCU\\Software\\Valve\\Steam';

const writeValue = async (
  name: string,
  type: 'REG_SZ' | 'REG_DWORD',
  data: string,
): Promise<void> => {
  await execFileAsync('reg', ['add', STEAM_KEY, '/v', name, '/t', type, '/d', data, '/f'], {
    windowsHide: true,
  });
};

const deleteValue = async (name: string): Promise<void> => {
  try {
    await execFileAsync('reg', ['delete', STEAM_KEY, '/v', name, '/f'], { windowsHide: true });
  } catch {}
};

export const setAutoLoginUser = async (layout: SteamLayout, login: string): Promise<void> => {
  if (layout.registryVdfPath) {
    await patchSteamRegistryVdf(layout.registryVdfPath, {
      AutoLoginUser: login,
      RememberPassword: '1',
    });
    return;
  }
  if (process.platform !== 'win32') return;
  await writeValue('AutoLoginUser', 'REG_SZ', login);
  await writeValue('RememberPassword', 'REG_DWORD', '1');
};

export const clearAutoLoginUser = async (layout: SteamLayout): Promise<void> => {
  if (layout.registryVdfPath) {
    await patchSteamRegistryVdf(layout.registryVdfPath, {
      AutoLoginUser: null,
      RememberPassword: null,
    });
    return;
  }
  if (process.platform !== 'win32') return;
  await deleteValue('AutoLoginUser');
  await deleteValue('RememberPassword');
};

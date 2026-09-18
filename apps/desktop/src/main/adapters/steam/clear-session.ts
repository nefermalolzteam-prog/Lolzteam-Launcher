import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log/main';
import { shutdownSteam } from './control';
import { findSteamInstall } from './paths';
import { clearAutoLoginUser } from './registry';
import { writeVdfFile } from './vdf';
import { type VdfObject, getObj, parseVdf, writeVdfString } from './vdf-parse';

export interface ClearSteamSessionResult {
  ok: boolean;
  message?: string;
}

const SUPPORTED = new Set<NodeJS.Platform>(['win32', 'linux', 'darwin']);

const rewriteVdf = async (path: string, mutate: (root: VdfObject) => boolean): Promise<void> => {
  let text: string;
  try {
    text = await fs.readFile(path, 'utf8');
  } catch {
    return; // File doesn't exist — nothing to clear.
  }
  const root = parseVdf(text);
  if (!mutate(root)) return;
  await writeVdfFile(path, writeVdfString(root));
};

const clearObject = (obj: VdfObject): boolean => {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  for (const key of keys) delete obj[key];
  return true;
};

export const clearSteamSession = async (): Promise<ClearSteamSessionResult> => {
  if (!SUPPORTED.has(process.platform)) {
    return {
      ok: false,
      message: 'Clearing the Steam session is available on Windows, Linux and macOS',
    };
  }

  const install = await findSteamInstall();
  if (!install) {
    return { ok: false, message: 'Steam was not found on the system' };
  }
  const { layout } = install;

  if (!(await shutdownSteam(install, log))) {
    return { ok: false, message: 'Steam did not close — close it manually and retry' };
  }

  await rewriteVdf(join(layout.configDir, 'loginusers.vdf'), (root) => {
    const users = root.users;
    if (!users || typeof users !== 'object') return false;
    return clearObject(users);
  });

  await rewriteVdf(join(layout.configDir, 'config.vdf'), (root) => {
    const store = root.InstallConfigStore;
    if (!store || typeof store !== 'object') return false;
    const steam = getObj(getObj(getObj(store, 'Software'), 'Valve'), 'Steam');
    const accounts = steam.Accounts;
    if (!accounts || typeof accounts !== 'object') return false;
    return clearObject(accounts);
  });

  await rewriteVdf(layout.localVdfPath, (root) => {
    const store = root.MachineUserConfigStore;
    if (!store || typeof store !== 'object') return false;
    const steam = getObj(getObj(getObj(store, 'Software'), 'Valve'), 'Steam');
    const cache = steam.ConnectCache;
    if (!cache || typeof cache !== 'object') return false;
    return clearObject(cache);
  });

  await clearAutoLoginUser(layout);

  return { ok: true };
};

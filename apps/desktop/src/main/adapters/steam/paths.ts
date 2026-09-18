import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  type SteamLayout,
  darwinLayout,
  linuxFlatpakLayout,
  linuxNativeLayout,
  win32Layout,
} from './layout';

const execFileAsync = promisify(execFile);

export interface SteamLauncher {
  command: string;
  args: readonly string[];
}

export interface SteamInstall {
  layout: SteamLayout;
  launcher: SteamLauncher;
}

let cached: SteamInstall | undefined;

const queryRegistry = async (): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync(
      'reg',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { windowsHide: true },
    );
    const match = stdout.match(/SteamPath\s+REG_\w+\s+(.+)/i);
    if (!match) return null;
    const raw = match[1]?.trim();
    if (!raw) return null;
    return raw.replace(/\//g, '\\');
  } catch {
    return null;
  }
};

const findWin32 = async (): Promise<SteamInstall | null> => {
  const steamDir = await queryRegistry();
  if (!steamDir) return null;
  if (!existsSync(join(steamDir, 'Steam.exe'))) return null;
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return {
    layout: win32Layout(steamDir, localAppData),
    launcher: { command: 'cmd', args: ['/c', 'start', ''] },
  };
};

const LINUX_BINARY_DIRS = ['/usr/bin', '/usr/games', '/usr/local/bin'];
const FLATPAK_BINARIES = ['/usr/bin/flatpak', '/usr/local/bin/flatpak'];

type Exists = (path: string) => boolean;
type Realpath = (path: string) => string;

const realpathOrSelf: Realpath = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const findOnPath = (name: string, env: NodeJS.ProcessEnv, exists: Exists): string | null => {
  const dirs = [...LINUX_BINARY_DIRS, ...(env.PATH ?? '').split(':').filter((d) => d !== '')];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
};

export const findLinuxInstall = (
  home: string,
  env: NodeJS.ProcessEnv,
  exists: Exists = existsSync,
  realpath: Realpath = realpathOrSelf,
): SteamInstall | null => {
  const looksLikeSteamDir = (dir: string) =>
    exists(join(dir, 'steam.sh')) || exists(join(dir, 'config'));

  const dataHome = env.XDG_DATA_HOME || join(home, '.local', 'share');

  const native = [
    join(dataHome, 'Steam'),
    join(home, '.steam', 'steam'),
    join(home, '.steam', 'root'),
    join(home, '.steam', 'debian-installation'),
  ].find(looksLikeSteamDir);

  if (native) {
    const command = findOnPath('steam', env, exists);
    if (command) {
      return { layout: linuxNativeLayout(realpath(native), home), launcher: { command, args: [] } };
    }
  }

  const flatpakHome = join(home, '.var', 'app', 'com.valvesoftware.Steam');
  if (looksLikeSteamDir(join(flatpakHome, 'data', 'Steam'))) {
    const command = FLATPAK_BINARIES.find(exists);
    if (command) {
      return {
        layout: linuxFlatpakLayout(flatpakHome),
        launcher: { command, args: ['run', 'com.valvesoftware.Steam'] },
      };
    }
  }

  return null;
};

const DARWIN_STEAM_BINARIES = (home: string): string[] => [
  '/Applications/Steam.app/Contents/MacOS/Steam',
  join(home, 'Applications', 'Steam.app', 'Contents', 'MacOS', 'Steam'),
];

export const findDarwinInstall = (
  home: string,
  exists: Exists = existsSync,
): SteamInstall | null => {
  const steamDir = join(home, 'Library', 'Application Support', 'Steam');
  const looksLikeSteamDir =
    exists(join(steamDir, 'config')) || exists(join(steamDir, 'registry.vdf'));
  if (!looksLikeSteamDir) return null;
  const command = DARWIN_STEAM_BINARIES(home).find(exists);
  if (!command) return null;
  return { layout: darwinLayout(steamDir), launcher: { command, args: [] } };
};

const stillPresent = (install: SteamInstall): boolean =>
  install.layout.flavor === 'win32'
    ? existsSync(join(install.layout.steamDir, 'Steam.exe'))
    : existsSync(join(install.layout.steamDir, 'config')) ||
      existsSync(join(install.layout.steamDir, 'steam.sh'));

export const findSteamInstall = async (): Promise<SteamInstall | null> => {
  if (cached && stillPresent(cached)) return cached;
  cached = undefined;
  const found =
    process.platform === 'win32'
      ? await findWin32()
      : process.platform === 'linux'
        ? findLinuxInstall(homedir(), process.env)
        : process.platform === 'darwin'
          ? findDarwinInstall(homedir())
          : null;
  if (!found) return null;
  cached = found;
  return cached;
};

export const resetSteamPathCache = (): void => {
  cached = undefined;
};

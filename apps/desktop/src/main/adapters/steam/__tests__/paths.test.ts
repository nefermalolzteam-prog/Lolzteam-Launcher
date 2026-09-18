import { describe, expect, it } from 'vitest';
import { findDarwinInstall, findLinuxInstall } from '../paths';

const HOME = '/home/u';

/** Treats every listed path — and nothing else — as present on disk. */
const fsWith = (...present: string[]) => {
  const set = new Set(present);
  return (path: string) => set.has(path);
};

const STEAM_BIN = '/usr/bin/steam';
const DATA_ROOT = '/home/u/.local/share/Steam';

describe('findLinuxInstall', () => {
  it('finds a stock install under ~/.local/share/Steam', () => {
    const found = findLinuxInstall(HOME, {}, fsWith(`${DATA_ROOT}/steam.sh`, STEAM_BIN));
    expect(found?.layout.flavor).toBe('linux-native');
    expect(found?.layout.steamDir).toBe(DATA_ROOT);
    expect(found?.layout.registryVdfPath).toBe('/home/u/.steam/registry.vdf');
    expect(found?.launcher).toEqual({ command: STEAM_BIN, args: [] });
  });

  it('honours XDG_DATA_HOME', () => {
    const found = findLinuxInstall(
      HOME,
      { XDG_DATA_HOME: '/data/xdg' },
      fsWith('/data/xdg/Steam/steam.sh', STEAM_BIN),
    );
    expect(found?.layout.steamDir).toBe('/data/xdg/Steam');
  });

  it('falls back to ~/.steam/steam when the data root is elsewhere', () => {
    const found = findLinuxInstall(HOME, {}, fsWith('/home/u/.steam/steam/config', STEAM_BIN));
    expect(found?.layout.steamDir).toBe('/home/u/.steam/steam');
  });

  it('accepts a Debian-style install root', () => {
    const found = findLinuxInstall(
      HOME,
      {},
      fsWith('/home/u/.steam/debian-installation/steam.sh', '/usr/games/steam'),
    );
    expect(found?.layout.steamDir).toBe('/home/u/.steam/debian-installation');
    expect(found?.launcher.command).toBe('/usr/games/steam');
  });

  it('finds a flatpak install and launches it through flatpak', () => {
    const appHome = '/home/u/.var/app/com.valvesoftware.Steam';
    const found = findLinuxInstall(
      HOME,
      {},
      fsWith(`${appHome}/data/Steam/steam.sh`, '/usr/bin/flatpak'),
    );
    expect(found?.layout.flavor).toBe('linux-flatpak');
    expect(found?.layout.steamDir).toBe(`${appHome}/data/Steam`);
    expect(found?.launcher).toEqual({
      command: '/usr/bin/flatpak',
      args: ['run', 'com.valvesoftware.Steam'],
    });
  });

  it('prefers a native install over a flatpak one when both are present', () => {
    const appHome = '/home/u/.var/app/com.valvesoftware.Steam';
    const found = findLinuxInstall(
      HOME,
      {},
      fsWith(
        `${DATA_ROOT}/steam.sh`,
        `${appHome}/data/Steam/steam.sh`,
        STEAM_BIN,
        '/usr/bin/flatpak',
      ),
    );
    expect(found?.layout.flavor).toBe('linux-native');
  });

  it('reports nothing when the data root exists but no launcher does', () => {
    expect(findLinuxInstall(HOME, {}, fsWith(`${DATA_ROOT}/steam.sh`))).toBeNull();
  });

  it('ignores an empty directory left behind by an uninstall', () => {
    expect(findLinuxInstall(HOME, {}, fsWith(STEAM_BIN))).toBeNull();
  });
});

describe('findLinuxInstall path handling', () => {
  it('resolves a symlinked data root to the real directory Steam reports in /proc', () => {
    const real = '/home/u/Games/SteamLibrary';
    const found = findLinuxInstall(
      HOME,
      {},
      fsWith('/home/u/.steam/steam/steam.sh', STEAM_BIN),
      (path) => (path === '/home/u/.steam/steam' ? real : path),
    );
    expect(found?.layout.steamDir).toBe(real);
    expect(found?.layout.configDir).toBe(`${real}/config`);
    // The registry substitute is not under the data root and is left alone.
    expect(found?.layout.registryVdfPath).toBe('/home/u/.steam/registry.vdf');
  });

  it('finds a launcher anywhere on PATH, after the well-known directories', () => {
    const found = findLinuxInstall(
      HOME,
      { PATH: '/home/u/.nix-profile/bin:/usr/bin' },
      fsWith(`${DATA_ROOT}/steam.sh`, '/home/u/.nix-profile/bin/steam'),
    );
    expect(found?.launcher.command).toBe('/home/u/.nix-profile/bin/steam');
  });

  it('prefers /usr/bin/steam over a shim earlier on PATH', () => {
    const found = findLinuxInstall(
      HOME,
      { PATH: '/home/u/bin:/usr/bin' },
      fsWith(`${DATA_ROOT}/steam.sh`, '/home/u/bin/steam', STEAM_BIN),
    );
    expect(found?.launcher.command).toBe(STEAM_BIN);
  });
});

const MAC_HOME = '/Users/u';
const MAC_STEAM_DIR = '/Users/u/Library/Application Support/Steam';
const MAC_STEAM_BIN = '/Applications/Steam.app/Contents/MacOS/Steam';

describe('findDarwinInstall', () => {
  it('finds the stock install under ~/Library with the bundle in /Applications', () => {
    const found = findDarwinInstall(MAC_HOME, fsWith(`${MAC_STEAM_DIR}/config`, MAC_STEAM_BIN));
    expect(found?.layout.flavor).toBe('darwin');
    expect(found?.layout.steamDir).toBe(MAC_STEAM_DIR);
    expect(found?.layout.registryVdfPath).toBe(`${MAC_STEAM_DIR}/registry.vdf`);
    expect(found?.launcher).toEqual({ command: MAC_STEAM_BIN, args: [] });
  });

  it('accepts a data root recognised by registry.vdf alone', () => {
    const found = findDarwinInstall(
      MAC_HOME,
      fsWith(`${MAC_STEAM_DIR}/registry.vdf`, MAC_STEAM_BIN),
    );
    expect(found?.layout.steamDir).toBe(MAC_STEAM_DIR);
  });

  it('falls back to a user-local bundle in ~/Applications', () => {
    const userBin = `${MAC_HOME}/Applications/Steam.app/Contents/MacOS/Steam`;
    const found = findDarwinInstall(MAC_HOME, fsWith(`${MAC_STEAM_DIR}/config`, userBin));
    expect(found?.launcher.command).toBe(userBin);
  });

  it('reports nothing without the Steam.app bundle, however healthy the data root', () => {
    expect(findDarwinInstall(MAC_HOME, fsWith(`${MAC_STEAM_DIR}/config`))).toBeNull();
  });

  it('ignores a data root an uninstall emptied out', () => {
    expect(findDarwinInstall(MAC_HOME, fsWith(MAC_STEAM_BIN))).toBeNull();
  });
});

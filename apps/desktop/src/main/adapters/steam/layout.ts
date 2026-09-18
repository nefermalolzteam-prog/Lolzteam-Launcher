import { join } from 'node:path';

// Where the Steam client keeps the four files a native login has to touch, and
// how to start and stop it. Windows and Linux disagree on every one of them:
//
//                     Windows                        Linux
//   steamDir          HKCU\...\Steam\SteamPath       ~/.local/share/Steam
//   config.vdf        <steamDir>\config\             <steamDir>/config/      (same)
//   loginusers.vdf    <steamDir>\config\             <steamDir>/config/      (same)
//   local.vdf         %LOCALAPPDATA%\Steam\          <steamDir>/            (!)
//   AutoLoginUser     registry HKCU                  ~/.steam/registry.vdf   (!)
//
// macOS follows the Linux column with one twist: everything — data *and*
// settings — lives inside the single data root, so registry.vdf sits there too.
//
// Everything here is a pure path calculation over explicit inputs so the
// per-platform wiring can be unit-tested without a Steam install.

export type SteamFlavor = 'win32' | 'linux-native' | 'linux-flatpak' | 'darwin';

export interface SteamLayout {
  flavor: SteamFlavor;
  /** Root holding `config/` and `userdata/`. */
  steamDir: string;
  /** Holds `config.vdf` and `loginusers.vdf`. */
  configDir: string;
  /** Holds the encrypted refresh token under `MachineUserConfigStore`. */
  localVdfPath: string;
  /** Linux stand-in for HKCU\Software\Valve\Steam; null where a real registry exists. */
  registryVdfPath: string | null;
}

export const userConfigDir = (layout: SteamLayout, steamId32: string): string =>
  join(layout.steamDir, 'userdata', steamId32, 'config');

export const win32Layout = (steamDir: string, localAppData: string): SteamLayout => ({
  flavor: 'win32',
  steamDir,
  configDir: join(steamDir, 'config'),
  localVdfPath: join(localAppData, 'Steam', 'local.vdf'),
  registryVdfPath: null,
});

// A stock Linux install: `~/.local/share/Steam` for data, `~/.steam/registry.vdf`
// for settings. `~/.steam/steam` is a symlink to the former, but we never
// resolve through it — Steam rewrites the real paths and so must we.
export const linuxNativeLayout = (steamDir: string, home: string): SteamLayout => ({
  flavor: 'linux-native',
  steamDir,
  configDir: join(steamDir, 'config'),
  localVdfPath: join(steamDir, 'local.vdf'),
  registryVdfPath: join(home, '.steam', 'registry.vdf'),
});

// Flatpak gives Steam a private HOME at `~/.var/app/com.valvesoftware.Steam`,
// so the native layout repeats verbatim one level down.
export const linuxFlatpakLayout = (appHome: string): SteamLayout => ({
  ...linuxNativeLayout(join(appHome, 'data', 'Steam'), appHome),
  flavor: 'linux-flatpak',
});

// The macOS client keeps its whole world under
// `~/Library/Application Support/Steam` — including `registry.vdf`, which on
// Linux lives in `~/.steam` instead. `local.vdf` is in the data root, as on
// Linux.
export const darwinLayout = (steamDir: string): SteamLayout => ({
  flavor: 'darwin',
  steamDir,
  configDir: join(steamDir, 'config'),
  localVdfPath: join(steamDir, 'local.vdf'),
  registryVdfPath: join(steamDir, 'registry.vdf'),
});

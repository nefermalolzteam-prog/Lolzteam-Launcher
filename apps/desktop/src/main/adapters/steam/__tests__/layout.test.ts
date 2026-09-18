import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  darwinLayout,
  linuxFlatpakLayout,
  linuxNativeLayout,
  userConfigDir,
  win32Layout,
} from '../layout';

// `layout.ts` joins with `node:path`, so on this (POSIX) test host the Windows
// paths come back with forward slashes. The separator is not what these assert:
// the point is *which directory* each file belongs to, which is where Windows
// and Linux actually differ.
describe('win32Layout', () => {
  const steamDir = join('C:', 'Program Files (x86)', 'Steam');
  const localAppData = join('C:', 'Users', 'u', 'AppData', 'Local');
  const layout = win32Layout(steamDir, localAppData);

  it('keeps config beside the install and local.vdf under LOCALAPPDATA', () => {
    expect(layout.configDir).toBe(join(steamDir, 'config'));
    expect(layout.localVdfPath).toBe(join(localAppData, 'Steam', 'local.vdf'));
    // The Windows client does *not* keep local.vdf in the install tree.
    expect(layout.localVdfPath.startsWith(steamDir)).toBe(false);
  });

  it('has no registry.vdf — Windows uses the real registry', () => {
    expect(layout.registryVdfPath).toBeNull();
  });
});

describe('linuxNativeLayout', () => {
  const layout = linuxNativeLayout('/home/u/.local/share/Steam', '/home/u');

  it('puts local.vdf in the data root, not under config/', () => {
    expect(layout.localVdfPath).toBe('/home/u/.local/share/Steam/local.vdf');
    expect(layout.configDir).toBe('/home/u/.local/share/Steam/config');
  });

  it('points at ~/.steam/registry.vdf, which lives outside the data root', () => {
    expect(layout.registryVdfPath).toBe('/home/u/.steam/registry.vdf');
  });
});

describe('linuxFlatpakLayout', () => {
  const layout = linuxFlatpakLayout('/home/u/.var/app/com.valvesoftware.Steam');

  it('repeats the native layout inside the sandbox HOME', () => {
    expect(layout.flavor).toBe('linux-flatpak');
    expect(layout.steamDir).toBe('/home/u/.var/app/com.valvesoftware.Steam/data/Steam');
    expect(layout.localVdfPath).toBe(
      '/home/u/.var/app/com.valvesoftware.Steam/data/Steam/local.vdf',
    );
    expect(layout.registryVdfPath).toBe(
      '/home/u/.var/app/com.valvesoftware.Steam/.steam/registry.vdf',
    );
  });
});

describe('darwinLayout', () => {
  const layout = darwinLayout('/Users/u/Library/Application Support/Steam');

  it('keeps everything, registry.vdf included, inside the data root', () => {
    expect(layout.flavor).toBe('darwin');
    expect(layout.configDir).toBe('/Users/u/Library/Application Support/Steam/config');
    expect(layout.localVdfPath).toBe('/Users/u/Library/Application Support/Steam/local.vdf');
    // The one difference from Linux: no ~/.steam, the registry lives in the root.
    expect(layout.registryVdfPath).toBe('/Users/u/Library/Application Support/Steam/registry.vdf');
  });
});

describe('userConfigDir', () => {
  it('is the same shape on every platform', () => {
    const layout = linuxNativeLayout('/home/u/.local/share/Steam', '/home/u');
    expect(userConfigDir(layout, '100000001')).toBe(
      '/home/u/.local/share/Steam/userdata/100000001/config',
    );
  });
});

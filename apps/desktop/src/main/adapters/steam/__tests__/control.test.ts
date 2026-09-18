import { describe, expect, it } from 'vitest';
import {
  type SteamControlDeps,
  darwinAppBundleRoot,
  isSteamClientExe,
  shutdownSteam,
} from '../control';
import { darwinLayout, linuxFlatpakLayout, linuxNativeLayout } from '../layout';
import type { SteamInstall } from '../paths';

const STEAM = '/home/u/.local/share/Steam';

describe('isSteamClientExe', () => {
  it('accepts the client, its web helper and the runtime sandbox around it', () => {
    expect(isSteamClientExe(`${STEAM}/ubuntu12_32/steam`, STEAM)).toBe(true);
    expect(isSteamClientExe(`${STEAM}/ubuntu12_64/steamwebhelper`, STEAM)).toBe(true);
    expect(
      isSteamClientExe(
        `${STEAM}/steamrt64/pv-runtime/steam-runtime-steamrt/pressure-vessel/libexec/steam-runtime-tools-0/srt-bwrap`,
        STEAM,
      ),
    ).toBe(true);
  });

  it('leaves games, Proton and the Steam Linux Runtime alone', () => {
    expect(isSteamClientExe(`${STEAM}/steamapps/common/Dota 2/game/bin/dota2`, STEAM)).toBe(false);
    expect(isSteamClientExe(`${STEAM}/steamapps/common/Proton 9.0/files/bin/wine64`, STEAM)).toBe(
      false,
    );
    expect(isSteamClientExe(`${STEAM}/compatibilitytools.d/GE-Proton9/files/bin/wine`, STEAM)).toBe(
      false,
    );
  });

  it('leaves the macOS spelling of the library folder alone too', () => {
    const macRoot = '/Users/u/Library/Application Support/Steam';
    expect(isSteamClientExe(`${macRoot}/SteamApps/common/Dota 2/game/bin/dota2`, macRoot)).toBe(
      false,
    );
  });

  it('does not match a sibling directory that merely shares the prefix', () => {
    expect(isSteamClientExe('/home/u/.local/share/Steam2/ubuntu12_32/steam', STEAM)).toBe(false);
    expect(isSteamClientExe(null, STEAM)).toBe(false);
  });

  it('tolerates a trailing slash on the data root', () => {
    expect(isSteamClientExe(`${STEAM}/ubuntu12_32/steam`, `${STEAM}/`)).toBe(true);
  });
});

const install = (flavor: 'native' | 'flatpak' = 'native'): SteamInstall => ({
  layout:
    flavor === 'native'
      ? linuxNativeLayout(STEAM, '/home/u')
      : linuxFlatpakLayout('/home/u/.var/app/com.valvesoftware.Steam'),
  launcher: { command: '/usr/bin/steam', args: [] },
});

const quietLog = { info: () => {}, warn: () => {} };

/** A fake Steam: alive until a chosen step, recording every signal it gets. */
const fakeSteam = (diesOn: 'shutdown' | 'SIGTERM' | 'SIGKILL' | 'never') => {
  let alive = true;
  const events: string[] = [];
  const deps: SteamControlDeps = {
    clientPids: async () => (alive ? [4242] : []),
    signal: (pids, sig) => {
      events.push(`${sig}:${pids.join(',')}`);
      if (sig === diesOn) alive = false;
    },
    requestShutdown: () => {
      events.push('shutdown');
      if (diesOn === 'shutdown') alive = false;
    },
    flatpakRunning: async () => alive,
    flatpakKill: async () => {
      events.push('flatpak-kill');
      alive = false;
    },
    killGraceMs: { term: 60, kill: 60 },
  };
  return { deps, events };
};

describe('shutdownSteam on Linux', () => {
  it('returns at once when nothing is running, without asking anything to quit', async () => {
    const steam = fakeSteam('never');
    steam.deps.clientPids = async () => [];
    await expect(shutdownSteam(install(), quietLog, 60, steam.deps)).resolves.toBe(true);
    expect(steam.events).toEqual([]);
  });

  it('prefers the graceful -shutdown and sends no signal when it works', async () => {
    const steam = fakeSteam('shutdown');
    await expect(shutdownSteam(install(), quietLog, 60, steam.deps)).resolves.toBe(true);
    expect(steam.events).toEqual(['shutdown']);
  });

  it('escalates shutdown → SIGTERM → SIGKILL in that order', async () => {
    const steam = fakeSteam('SIGKILL');
    await expect(shutdownSteam(install(), quietLog, 60, steam.deps)).resolves.toBe(true);
    expect(steam.events).toEqual(['shutdown', 'SIGTERM:4242', 'SIGKILL:4242']);
  });

  it('stops at SIGTERM when that is enough', async () => {
    const steam = fakeSteam('SIGTERM');
    await expect(shutdownSteam(install(), quietLog, 60, steam.deps)).resolves.toBe(true);
    expect(steam.events).toEqual(['shutdown', 'SIGTERM:4242']);
  });

  it('reports failure when the client survives everything', async () => {
    const steam = fakeSteam('never');
    await expect(shutdownSteam(install(), quietLog, 60, steam.deps)).resolves.toBe(false);
    expect(steam.events).toEqual(['shutdown', 'SIGTERM:4242', 'SIGKILL:4242']);
  });

  it('asks flatpak to kill the app instead of signalling pids it cannot see', async () => {
    const steam = fakeSteam('never');
    await expect(shutdownSteam(install('flatpak'), quietLog, 60, steam.deps)).resolves.toBe(true);
    expect(steam.events).toEqual(['shutdown', 'flatpak-kill']);
  });
});

const MAC_STEAM = '/Users/u/Library/Application Support/Steam';
const MAC_BIN = '/Applications/Steam.app/Contents/MacOS/Steam';

const macInstall = (): SteamInstall => ({
  layout: darwinLayout(MAC_STEAM),
  launcher: { command: MAC_BIN, args: [] },
});

describe('darwinAppBundleRoot', () => {
  it('cuts the launcher path at the .app bundle boundary', () => {
    expect(darwinAppBundleRoot(MAC_BIN)).toBe('/Applications/Steam.app');
    expect(darwinAppBundleRoot('/Applications/Telegram Desktop.app/Contents/MacOS/Telegram')).toBe(
      '/Applications/Telegram Desktop.app',
    );
  });

  it('reports null for a path outside any bundle', () => {
    expect(darwinAppBundleRoot('/usr/bin/steam')).toBeNull();
  });
});

describe('shutdownSteam on macOS', () => {
  it('runs the same shutdown → SIGTERM → SIGKILL ladder as Linux', async () => {
    const steam = fakeSteam('SIGKILL');
    await expect(shutdownSteam(macInstall(), quietLog, 60, steam.deps)).resolves.toBe(true);
    expect(steam.events).toEqual(['shutdown', 'SIGTERM:4242', 'SIGKILL:4242']);
  });

  it('prefers the graceful -shutdown and stops there when it works', async () => {
    const steam = fakeSteam('shutdown');
    await expect(shutdownSteam(macInstall(), quietLog, 60, steam.deps)).resolves.toBe(true);
    expect(steam.events).toEqual(['shutdown']);
  });
});

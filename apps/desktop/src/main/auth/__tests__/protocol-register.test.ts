import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getName: () => '@lolzteam/desktop' } }));

const { buildLinuxExecLine, escapeDesktopExecArg } = await import('../protocol-register');

describe('escapeDesktopExecArg', () => {
  it('escapes what the Desktop Entry spec reserves inside a quoted argument', () => {
    expect(escapeDesktopExecArg('plain')).toBe('plain');
    expect(escapeDesktopExecArg('a\\b')).toBe('a\\\\b');
    expect(escapeDesktopExecArg('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeDesktopExecArg('$HOME')).toBe('\\$HOME');
    expect(escapeDesktopExecArg('`id`')).toBe('\\`id\\`');
  });

  it('doubles a literal percent so it is not read as a field code', () => {
    expect(escapeDesktopExecArg('/opt/100% sure/app')).toBe('/opt/100%% sure/app');
  });
});

describe('buildLinuxExecLine', () => {
  const projectRoot = () => '/home/u/src/launcher/apps/desktop';

  it("runs the AppImage itself, sandbox off like the bundle's own entry", () => {
    expect(
      buildLinuxExecLine({
        appImage: '/home/u/Apps/Lolzteam-Launcher-1.0.0-x86_64.AppImage',
        isPackaged: true,
        execPath: '/tmp/.mount_lolz/lolzteam-launcher',
        projectRoot,
      }),
    ).toBe('"/home/u/Apps/Lolzteam-Launcher-1.0.0-x86_64.AppImage" --no-sandbox %u');
  });

  it('runs the installed binary for a deb', () => {
    expect(
      buildLinuxExecLine({
        appImage: undefined,
        isPackaged: true,
        execPath: '/opt/Lolzteam Launcher/lolzteam-launcher',
        projectRoot,
      }),
    ).toBe('"/opt/Lolzteam Launcher/lolzteam-launcher" %u');
  });

  it('runs Electron on the project root in development', () => {
    expect(
      buildLinuxExecLine({
        appImage: undefined,
        isPackaged: false,
        execPath: '/home/u/src/launcher/node_modules/electron/dist/electron',
        projectRoot,
      }),
    ).toBe(
      '"/home/u/src/launcher/node_modules/electron/dist/electron" "/home/u/src/launcher/apps/desktop" %u',
    );
  });

  it('keeps a hostile path from breaking out of the Exec line', () => {
    const line = buildLinuxExecLine({
      appImage: '/home/u/50% off "deals"/$app`.AppImage',
      isPackaged: true,
      execPath: '',
      projectRoot,
    });
    expect(line).toBe('"/home/u/50%% off \\"deals\\"/\\$app\\`.AppImage" --no-sandbox %u');
  });
});

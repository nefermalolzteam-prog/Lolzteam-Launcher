import { describe, expect, it } from 'vitest';
import { cleanSpawnEnv } from '../spawn-env';

const APPDIR = '/tmp/.mount_lolzAB12';

describe('cleanSpawnEnv inside an AppImage', () => {
  it("removes only the entries AppRun prepended, keeping the user's own", () => {
    const env = cleanSpawnEnv(
      {
        APPDIR,
        LD_LIBRARY_PATH: `${APPDIR}/usr/lib:/opt/mine/lib`,
        XDG_DATA_DIRS: `${APPDIR}/usr/share/:/usr/local/share/:/usr/share/:./share/`,
        PATH: '/usr/bin',
      },
      'linux',
    );
    expect(env.LD_LIBRARY_PATH).toBe('/opt/mine/lib');
    expect(env.XDG_DATA_DIRS).toBe('/usr/local/share/:/usr/share/');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('drops a variable that pointed into the bundle and nowhere else', () => {
    const env = cleanSpawnEnv({ APPDIR, LD_LIBRARY_PATH: `${APPDIR}/usr/lib` }, 'linux');
    expect(env).not.toHaveProperty('LD_LIBRARY_PATH');
  });

  it('prefers a saved _ORIG snapshot when the runtime left one', () => {
    const env = cleanSpawnEnv(
      { APPDIR, LD_LIBRARY_PATH: `${APPDIR}/usr/lib`, LD_LIBRARY_PATH_ORIG: '/usr/local/lib' },
      'linux',
    );
    expect(env.LD_LIBRARY_PATH).toBe('/usr/local/lib');
    expect(env).not.toHaveProperty('LD_LIBRARY_PATH_ORIG');
  });

  it('drops the variables that describe our own bundle', () => {
    const env = cleanSpawnEnv(
      {
        APPDIR,
        APPIMAGE: '/home/u/Lolzteam.AppImage',
        ARGV0: './Lolzteam.AppImage',
        HOME: '/home/u',
      },
      'linux',
    );
    expect(env).toEqual({ HOME: '/home/u' });
  });
});

describe('cleanSpawnEnv outside an AppImage', () => {
  it("passes the user's loader environment through untouched", () => {
    const source = {
      HOME: '/home/u',
      LD_LIBRARY_PATH: '/opt/mine/lib',
      LD_PRELOAD: '/usr/lib/libgamemode.so',
      XDG_DATA_DIRS: '/usr/local/share:/usr/share',
      QT_PLUGIN_PATH: '/opt/qt/plugins',
    };
    expect(cleanSpawnEnv(source, 'linux')).toEqual(source);
  });

  it('still hides the Electron-only switches from children', () => {
    const env = cleanSpawnEnv(
      { ELECTRON_RUN_AS_NODE: '1', CHROME_DESKTOP: 'lolzteam.desktop', HOME: '/home/u' },
      'linux',
    );
    expect(env).toEqual({ HOME: '/home/u' });
  });

  it('does not mutate the environment it was handed', () => {
    const source = { APPDIR, LD_LIBRARY_PATH: `${APPDIR}/usr/lib` };
    cleanSpawnEnv(source, 'linux');
    expect(source.LD_LIBRARY_PATH).toBe(`${APPDIR}/usr/lib`);
  });
});

describe('cleanSpawnEnv elsewhere', () => {
  it('copies the environment through untouched on Windows', () => {
    const source = { APPDIR: 'C:\\app', LD_LIBRARY_PATH: 'x' };
    expect(cleanSpawnEnv(source, 'win32')).toEqual(source);
  });
});

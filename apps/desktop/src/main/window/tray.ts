import { execFile } from 'node:child_process';
import { Menu, Tray, app, nativeImage } from 'electron';
import log from 'electron-log/main';
import { appIconPath } from './app-icon';
import { setQuitting, setTrayAvailable, showMainWindow } from './main-window';

let tray: Tray | null = null;

// On Linux the icon is a StatusNotifierItem published over D-Bus. Building the
// Tray succeeds whether or not any panel is listening, so on a desktop without
// a StatusNotifier host (GNOME without the AppIndicator extension, a bare
// window manager) the icon simply never appears — and hiding the window into
// it would lose the app. Ask the watcher whether a host has registered; if the
// tools to ask are missing, assume the best rather than disable the feature.
const hasStatusNotifierHost = (): Promise<boolean | null> =>
  new Promise((resolve) => {
    execFile(
      'busctl',
      [
        '--user',
        'get-property',
        'org.kde.StatusNotifierWatcher',
        '/StatusNotifierWatcher',
        'org.kde.StatusNotifierWatcher',
        'IsStatusNotifierHostRegistered',
      ],
      { timeout: 3000 },
      (err, stdout) => {
        if (err) resolve(null);
        else resolve(/\btrue\b/.test(stdout));
      },
    );
  });

export const createTray = (): void => {
  if (tray) return;

  let image = nativeImage.createFromPath(appIconPath);
  if (image.isEmpty()) {
    // Nothing usable to show. A Tray built from an empty image is created but
    // never drawn, so the user would lose the only way back to a hidden window.
    throw new Error(`tray icon could not be loaded from ${appIconPath}`);
  }
  // Linux panels scale the icon themselves and 16px looks blurry there; the
  // Windows notification area expects exactly 16.
  image = process.platform === 'win32' ? image.resize({ width: 16, height: 16 }) : image;
  tray = new Tray(image);
  tray.setToolTip('Lolzteam Launcher');

  const menu = Menu.buildFromTemplate([
    { label: 'Открыть Lolzteam Launcher', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        setQuitting(true);
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  setTrayAvailable(true);

  if (process.platform === 'linux') {
    void hasStatusNotifierHost().then((registered) => {
      if (registered === false) {
        log.warn(
          '[tray] no StatusNotifier host on this desktop — icon is invisible, minimize-to-tray disabled',
        );
        setTrayAvailable(false);
      }
    });
  }
};

export const destroyTray = (): void => {
  tray?.destroy();
  tray = null;
  setTrayAvailable(false);
};

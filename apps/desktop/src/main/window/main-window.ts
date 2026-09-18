import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, shell } from 'electron';
import { getCachedSettings } from '../settings/settings-store';
import { MAIN_COLORS } from '../theme';
import { appIconPath } from './app-icon';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let mainWindow: BrowserWindow | null = null;

let quitting = false;
export const setQuitting = (v: boolean): void => {
  quitting = v;
};
export const isQuitting = (): boolean => quitting;

// Set by `createTray()` once a tray icon actually exists. On Linux the icon can
// fail to load or the desktop may offer no status-notifier host at all, and
// hiding the window to a tray that isn't there loses the app with no way back —
// so "minimize to tray" is only honoured when there is a tray to minimize to.
let trayAvailable = false;
export const setTrayAvailable = (v: boolean): void => {
  trayAvailable = v;
};
export const shouldMinimizeToTray = (): boolean =>
  trayAvailable && (getCachedSettings()?.minimizeToTray ?? true);

export const getMainWindow = (): BrowserWindow | null =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;

export const showMainWindow = (): void => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

export const createMainWindow = (): BrowserWindow => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: MAIN_COLORS.bg,
    icon: appIconPath,
    title: 'Lolzteam Launcher',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.setMenu(null);

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (e) => {
    if (quitting) return;
    if (shouldMinimizeToTray()) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;

  // The app never navigates its own frame; any top-level navigation attempt
  // (e.g. a dropped link or injected anchor) must not replace the renderer.
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const isInternal = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://');
    if (!isInternal) {
      e.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
};

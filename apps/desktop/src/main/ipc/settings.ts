import { IPC_CHANNELS } from '@shared-ipc';
import type { LauncherSettings, PickFileOptions, SettingsResponse } from '@shared-types';
import type { OpenDialogOptions } from 'electron';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import { logAction } from '../services/action-log';
import { resolveEffectiveLocale } from '../settings/locale';
import { sanitizeSettingsPatch } from '../settings/settings-patch';
import { getSettings, onSettingsChange, setSettings } from '../settings/settings-store';
import { getMainWindow } from '../window/main-window';

const respond = (settings: LauncherSettings): SettingsResponse => ({
  settings,
  effectiveLocale: resolveEffectiveLocale(settings.locale),
});

/** The names of the keys a patch touched, and never their values. */
const patchedKeys = (patch?: Partial<LauncherSettings>): string[] =>
  patch && typeof patch === 'object' ? Object.keys(patch) : [];

/** Whether a save is worth a line in the journal. */
const isViewState = (key: string): boolean => key.startsWith('inventory');

export const registerSettingsIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => respond(await getSettings()));

  /** Whatever the renderer sent, reduced to the fields that are the shape they claim to be. */
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_e, raw: Partial<LauncherSettings>) => {
    const { patch, rejected } = sanitizeSettingsPatch(raw);
    if (rejected.length > 0) {
      log.warn(`[settings] dropped fields of the wrong shape: ${rejected.join(', ')}`);
    }
    const worth = patchedKeys(patch).filter((key) => !isViewState(key));
    if (worth.length === 0) return respond(await setSettings(patch));
    return respond(
      await logAction('settings.save', { target: worth.join(', ') }, () => setSettings(patch)),
    );
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_PICK_FILE, async (event, opts: PickFileOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: opts.title,
      defaultPath: opts.defaultPath,
      properties: opts.directory ? ['openDirectory', 'createDirectory'] : ['openFile'],
    };
    // A folder dialog has nothing to filter, and passing filters anyway makes GTK show an empty file-type dropdown.
    if (!opts.directory) options.filters = opts.filters;
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  /** The settings object is broadcast to the main window and to nothing else. */
  onSettingsChange((settings) => {
    const win = getMainWindow();
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SETTINGS_CHANGED, respond(settings));
    }
  });
};

import { IPC_CHANNELS, type UpdateStatus } from '@shared-ipc';
import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import electronUpdater from 'electron-updater';
import { logAction, recordAction } from './services/action-log';
import { getMainWindow } from './window/main-window';

const { autoUpdater } = electronUpdater;

const emit = (status: UpdateStatus) => {
  getMainWindow()?.webContents.send(IPC_CHANNELS.UPDATE_STATUS, status);
};

let wired = false;

const wireEvents = () => {
  if (wired) return;
  wired = true;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    emit({
      state: 'available',
      version: info.version,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
    }),
  );
  autoUpdater.on('update-not-available', () => emit({ state: 'not-available' }));
  autoUpdater.on('download-progress', (p) =>
    emit({
      state: 'downloading',
      percent: Math.round(p.percent),
      transferred: p.transferred,
      total: p.total,
    }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    emit({ state: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err) => emit({ state: 'error', message: err?.message ?? String(err) }));
};

export const registerUpdaterIpc = () => {
  if (!app.isPackaged) {
    ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, () => {});
    ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, () => {});
    ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => {});
    return;
  }

  wireEvents();

  /** The check, the download and the restart, journalled. */
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async () => {
    try {
      await logAction(
        'update.check',
        { detail: (r) => (r ? `found ${r.updateInfo.version}` : null) },
        () => autoUpdater.checkForUpdates(),
      );
    } catch (err) {
      log.error('[updater] check failed', err);
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => {
    try {
      await logAction('update.download', {}, () => autoUpdater.downloadUpdate());
    } catch (err) {
      log.error('[updater] download failed', err);
      emit({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL, () => {
    // Written before the call, not after: `quitAndInstall` does not return.
    recordAction({ action: 'update.install', status: 'ok', durationMs: 0, detail: null });
    autoUpdater.quitAndInstall();
  });

  setTimeout(() => {
    void autoUpdater
      .checkForUpdates()
      .catch((err) => log.error('[updater] initial check failed', err));
  }, 3000);
};

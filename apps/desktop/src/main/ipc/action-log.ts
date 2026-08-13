import { writeFile } from 'node:fs/promises';
import { IPC_CHANNELS } from '@shared-ipc';
import type { ActionDraft } from '@shared-types';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import { clearActions, flushActions, listActions, recordAction } from '../services/action-log';

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

export const registerActionLogIpc = () => {
  ipcMain.handle(IPC_CHANNELS.ACTION_LOG_LIST, () => listActions());

  ipcMain.handle(IPC_CHANNELS.ACTION_LOG_RECORD, (_e, payload?: ActionDraft) => {
    if (!payload) return;
    // Passed straight through: every field is clipped, checked and re-stamped by the store.
    recordAction(payload);
  });

  ipcMain.handle(IPC_CHANNELS.ACTION_LOG_CLEAR, () => clearActions());

  ipcMain.handle(IPC_CHANNELS.ACTION_LOG_EXPORT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const opts = {
      title: 'Export action log',
      defaultPath: `lolzteam-launcher-actions-${stamp()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (result.canceled || !result.filePath) return { ok: false };
    // Written from memory rather than copied from disk: the file on disk lags by up to a flush window.
    const entries = await listActions();
    await writeFile(
      result.filePath,
      JSON.stringify({ app: app.getVersion(), exportedAt: Date.now(), entries }, null, 2),
      'utf8',
    );
    return { ok: true, path: result.filePath };
  });

  // The last entries of a session are the ones a user comes back to ask about.
  app.on('before-quit', () => {
    void flushActions();
  });
};

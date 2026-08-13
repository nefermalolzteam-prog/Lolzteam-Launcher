import { IPC_CHANNELS } from '@shared-ipc';
import type { AuthTokenSubmitResult } from '@shared-ipc';
import type { AuthStatus } from '@shared-types';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
import { clearToken, loadToken, onTokenChange, saveToken } from '../auth/token-store';
import { fetchProfileResult, probeToken } from '../services/market';
import { handleAction } from './handle-action';

const buildStatus = async (): Promise<AuthStatus> => {
  const token = await loadToken();
  if (!token) return { authenticated: false, session: null };
  const result = await fetchProfileResult();
  if (result.kind === 'offline') {
    return { authenticated: true, session: null, offline: true };
  }
  if (result.kind === 'unauthorized') {
    return { authenticated: false, session: null };
  }
  return { authenticated: true, session: result.session };
};

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
};

export const registerAuthIpc = () => {
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATUS, () => buildStatus());

  handleAction(
    IPC_CHANNELS.AUTH_SUBMIT_TOKEN,
    async (_e, req: { token: string }): Promise<AuthTokenSubmitResult> => {
      const token = typeof req?.token === 'string' ? req.token.trim() : '';
      if (!token) return { ok: false, reason: 'empty' };
      const result = await probeToken(token);
      if (result.kind === 'unauthorized') return { ok: false, reason: 'rejected' };
      if (result.kind === 'offline') return { ok: false, reason: 'offline' };
      await saveToken(token);
      log.info(`[auth] signed in by token as ${result.session.username}`);
      return { ok: true };
    },
    {
      action: 'auth.token',
      detail: (r) => (r.ok ? 'signed in' : null),
    },
  );

  handleAction(
    IPC_CHANNELS.AUTH_LOGOUT,
    async () => {
      await clearToken();
    },
    { action: 'auth.logout' },
  );

  onTokenChange(async () => {
    broadcast(IPC_CHANNELS.AUTH_STATUS_CHANGED, await buildStatus());
  });
};

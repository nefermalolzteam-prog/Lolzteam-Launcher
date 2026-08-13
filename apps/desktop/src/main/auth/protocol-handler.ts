import { IPC_CHANNELS, LOLZ_CONFIG } from '@shared-ipc';
import { type BrowserWindow, ipcMain, shell } from 'electron';
import { acceptAuthCallback, issueState } from './auth-broker';

type GetWindow = () => BrowserWindow | null;

const buildAuthUrl = (state: string) => {
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: LOLZ_CONFIG.clientId,
    redirect_uri: LOLZ_CONFIG.authRedirectUri,
    scope: LOLZ_CONFIG.oauthScopes,
    state,
  });
  return `${LOLZ_CONFIG.authWebUrl}/account/authorize?${params.toString()}`;
};

export const registerAuthFlow = (getWindow: GetWindow) => {
  ipcMain.handle(IPC_CHANNELS.AUTH_OPEN_BROWSER, async () => {
    const state = issueState();
    await shell.openExternal(buildAuthUrl(state));
    return { state };
  });

  const protocolPrefix = `${LOLZ_CONFIG.protocolScheme}://`;

  const accountIdFromDeepLink = (url: string): number | null => {
    const rest = url.slice(protocolPrefix.length);
    const m = /^auth\/account\/(\d+)/.exec(rest);
    return m?.[1] ? Number(m[1]) : null;
  };

  return (url: string) => {
    if (!url.startsWith(protocolPrefix)) return;
    const itemId = accountIdFromDeepLink(url);
    if (itemId !== null) {
      const win = getWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
        win.webContents.send(IPC_CHANNELS.ACCOUNT_LOGIN_REQUEST, { itemId });
      }
      return;
    }
    void acceptAuthCallback(url, getWindow);
  };
};

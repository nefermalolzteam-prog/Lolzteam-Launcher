import type {
  AdapterContext,
  AdapterLogger,
  LoginMethod,
  LoginProgressEvent,
} from '@adapter-contract';
import { IPC_CHANNELS } from '@shared-ipc';
import type { IpcResponseMap } from '@shared-ipc';
import type { AccountDetails, ServiceId } from '@shared-types';
import { loginFeatureFor } from '@shared-types';
import { BrowserWindow, app, ipcMain } from 'electron';
import log from 'electron-log/main';
import { toDetails } from '../accounts/local-projection';
import { getLocalAccount } from '../accounts/local-store';
import { getAdapter } from '../adapters';
import { fetchEmailCode, fetchSteamMafile, getAccountDetails } from '../services/market';
import { trackFeature } from '../services/metrics';
import { getSettings } from '../settings/settings-store';
import { handleAction } from './handle-action';

type AccountLoginResult = IpcResponseMap[typeof IPC_CHANNELS.ACCOUNT_LOGIN];

const adapterLogger: AdapterLogger = {
  debug: (m, meta) => (meta === undefined ? log.debug(m) : log.debug(m, meta)),
  info: (m, meta) => (meta === undefined ? log.info(m) : log.info(m, meta)),
  warn: (m, meta) => (meta === undefined ? log.warn(m) : log.warn(m, meta)),
  error: (m, meta) => (meta === undefined ? log.error(m) : log.error(m, meta)),
};

const broadcast = (itemId: number, event: LoginProgressEvent): void => {
  const payload = { ...event, itemId };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.ACCOUNT_LOGIN_PROGRESS, payload);
  }
};

export const buildCtx = async (
  itemId: number,
  abortSignal: AbortSignal,
  category: ServiceId | null,
  proxyId?: string | null,
  proxyTest?: { ip: string; ms: number } | null,
): Promise<AdapterContext> => {
  const settings = await getSettings();
  const serviceAllowsProxy = category !== null && settings.proxyServices.includes(category);
  const proxy =
    settings.proxyEnabled && serviceAllowsProxy && proxyId
      ? settings.proxies.find((p) => p.id === proxyId)
      : undefined;
  const local = isLocalItemId(itemId);
  return {
    log: adapterLogger,
    paths: {
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
      temp: app.getPath('temp'),
    },
    abortSignal,
    onProgress: (event) => broadcast(itemId, event),
    fetchEmailCode: local ? undefined : (id) => fetchEmailCode(id, abortSignal),
    fetchSteamMafile: local ? undefined : (id) => fetchSteamMafile(id, abortSignal),
    settings,
    proxy,
    proxyTest: proxy && proxyTest ? proxyTest : undefined,
  };
};

const isLocalItemId = (itemId: number): boolean => itemId < 0;

const resolveDetails = async (
  itemId: number,
  signal: AbortSignal,
): Promise<AccountDetails | null> => {
  if (!isLocalItemId(itemId)) return getAccountDetails(itemId, signal);
  const record = await getLocalAccount(itemId);
  return record ? toDetails(record) : null;
};

// One in-flight login per account. Lets ACCOUNT_LOGIN_CANCEL abort a hung
// attempt (e.g. Telegram code never arrives) instead of leaving the modal stuck.
const activeLogins = new Map<number, AbortController>();

export const registerLoginIpc = (): void => {
  handleAction(
    IPC_CHANNELS.ACCOUNT_LOGIN,
    async (
      _e,
      payload: {
        itemId: number;
        method: LoginMethod;
        proxyId?: string | null;
        proxyTest?: { ip: string; ms: number } | null;
      },
    ): Promise<AccountLoginResult> => {
      const { itemId, method, proxyId, proxyTest } = payload;
      if (!Number.isInteger(itemId) || itemId === 0) {
        return { ok: false, message: 'Некорректный идентификатор аккаунта' };
      }
      activeLogins.get(itemId)?.abort();
      const ctl = new AbortController();
      activeLogins.set(itemId, ctl);
      const release = (): void => {
        if (activeLogins.get(itemId) === ctl) activeLogins.delete(itemId);
      };
      broadcast(itemId, { step: 'fetching-credentials' });

      const details = await resolveDetails(itemId, ctl.signal);
      if (!details) {
        release();
        return ctl.signal.aborted
          ? { ok: false, message: 'Вход отменён', cancelled: true }
          : { ok: false, message: 'Не удалось получить данные аккаунта' };
      }

      const adapter = getAdapter(details.category);
      if (!adapter) {
        release();
        return {
          ok: false,
          message: `Сервис "${details.categoryTitle}" пока не поддерживается`,
        };
      }

      try {
        const ctx = await buildCtx(itemId, ctl.signal, details.category, proxyId, proxyTest);
        const result = await adapter.login(method, details, ctx);
        if (result.ok) {
          broadcast(itemId, { step: 'done' });
          const feature = loginFeatureFor(details.category);
          if (feature) trackFeature(feature);
        }
        return { ok: result.ok, message: result.message };
      } catch (err) {
        if (ctl.signal.aborted) return { ok: false, message: 'Вход отменён', cancelled: true };
        log.error('[login] adapter threw', err);
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Неизвестная ошибка',
        };
      } finally {
        release();
      }
    },
    {
      action: 'account.login',
      itemId: (p) => p?.itemId ?? null,
      target: (p) => p?.method ?? null,
      status: (r) => (r.cancelled ? 'cancelled' : null),
    },
  );

  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LOGIN_CANCEL, (_e, payload: { itemId: number }) => {
    activeLogins.get(payload.itemId)?.abort();
  });
};

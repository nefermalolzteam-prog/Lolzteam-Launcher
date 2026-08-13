import { IPC_CHANNELS, type IpcRequestMap } from '@shared-ipc';
import { isProxyHost } from '@shared-types';
import { ipcMain } from 'electron';
import { fetchMarketProxies } from '../services/market';
import { testProxy } from '../services/proxy';
import { handleAction } from './handle-action';

type TestInput = IpcRequestMap[typeof IPC_CHANNELS.PROXY_TEST];

const validTestInput = (input: unknown): input is TestInput => {
  if (input === null || typeof input !== 'object') return false;
  const { host, port, username, password, protocol } = input as Record<string, unknown>;
  if (typeof host !== 'string' || !isProxyHost(host)) return false;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) return false;
  if (username !== undefined && typeof username !== 'string') return false;
  if (password !== undefined && typeof password !== 'string') return false;
  if (protocol !== undefined && protocol !== 'http' && protocol !== 'https') return false;
  return true;
};

export const registerProxyIpc = (): void => {
  ipcMain.handle(IPC_CHANNELS.PROXY_TEST, (_e, input: TestInput) =>
    validTestInput(input)
      ? testProxy(input)
      : Promise.resolve({ ok: false as const, message: 'Некорректный адрес прокси' }),
  );

  handleAction(
    IPC_CHANNELS.PROXY_FETCH_MARKET,
    async () => {
      try {
        const proxies = await fetchMarketProxies();
        return { ok: true as const, proxies };
      } catch (err) {
        return { ok: false as const, message: err instanceof Error ? err.message : 'fetch_failed' };
      }
    },
    {
      action: 'proxy.fetchMarket',
      detail: (r) => (r.ok ? `${r.proxies.length} proxies` : null),
    },
  );
};

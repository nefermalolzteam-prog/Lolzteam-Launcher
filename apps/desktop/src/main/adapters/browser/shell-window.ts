import type { AdapterContext } from '@adapter-contract';
import { BrowserWindow, type WebContents, session } from 'electron';
import { applyProxyToSession, clearProxyFromSession } from '../../services/proxy';
import { MAIN_COLORS } from '../../theme';
import { createBrowserShell } from './browser-shell';
import type { InjectableCookie } from './extract';

export const injectCookies = async (
  partition: string,
  cookies: InjectableCookie[],
  ctx: AdapterContext,
): Promise<void> => {
  const ses = session.fromPartition(partition);
  await ses.clearStorageData();

  if (ctx.proxy) {
    await applyProxyToSession(ses, ctx.proxy);
    ctx.log.info(`[browser] routing #${partition} via proxy ${ctx.proxy.host}:${ctx.proxy.port}`);
  } else {
    await clearProxyFromSession(ses);
  }

  for (const cookie of cookies) {
    try {
      await ses.cookies.set(cookie);
    } catch (err) {
      ctx.log.warn(`[browser] failed to set cookie ${cookie.name}`, err);
    }
  }
};

export const openBrowserWindow = (
  partition: string,
  landingUrl: string,
  title: string,
  ctx: AdapterContext,
  opts?: {
    onEachLoad?: (site: WebContents) => void;
    emailPassword?: string;
    plantBeforeScripts?: (site: WebContents) => Promise<void> | void;
  },
): { windowId: number } => {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: MAIN_COLORS.bg,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);

  const { siteView } = createBrowserShell(win, {
    partition,
    log: ctx.log,
    proxy: ctx.proxy,
    proxyTest: ctx.proxyTest,
    emailPassword: opts?.emailPassword,
  });
  if (opts?.plantBeforeScripts) {
    const ses = session.fromPartition(partition);
    let blocking = true;
    const unblock = () => {
      if (!blocking) return;
      blocking = false;
      ses.webRequest.onBeforeRequest(null);
    };
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: blocking && details.resourceType === 'script' });
    });
    siteView.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          await opts.plantBeforeScripts?.(siteView.webContents);
        } catch (err) {
          ctx.log.warn('[browser] pre-script injection failed', err);
        }
        unblock();
        siteView.webContents.reload();
      })();
    });
    win.on('closed', unblock);
  } else if (opts?.onEachLoad) {
    siteView.webContents.on('did-finish-load', () => opts.onEachLoad?.(siteView.webContents));
  }
  siteView.webContents.loadURL(landingUrl).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log.warn(`[browser] loadURL failed: ${msg}`);
  });

  return { windowId: win.id };
};

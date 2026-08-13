import type { AdapterLogger } from '@adapter-contract';
import { type Session, type WebContents, shell } from 'electron';

/** `http:`/`https:` and nothing else — the only schemes a site may navigate to. */
export const isWebUrl = (raw: string): boolean => {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/** Permissions granted without asking. */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
]);

export const isAllowedPermission = (permission: string): boolean =>
  ALLOWED_PERMISSIONS.has(permission);

/** Deny every permission the page did not earn. */
export const guardSessionPermissions = (ses: Session, log: AdapterLogger): void => {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = isAllowedPermission(permission);
    if (!allowed) log.info(`[browser] denied permission "${permission}"`);
    callback(allowed);
  });
  // The synchronous half of the same question (`navigator.permissions.query`, and Electron's own internal checks).
  ses.setPermissionCheckHandler((_wc, permission) => isAllowedPermission(permission));
};

/** Popups and off-web navigation, for one `WebContents`. */
export const guardWebContents = (wc: WebContents, log: AdapterLogger): void => {
  wc.setWindowOpenHandler(({ url }) => {
    if (!isWebUrl(url)) {
      log.warn(`[browser] blocked window.open to a non-web URL: ${url.slice(0, 120)}`);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        // No `partition`: a window opened this way inherits the opener's session on its own.
        webPreferences: {
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webviewTag: false,
        },
      },
    };
  });

  wc.on('did-create-window', (child) => {
    child.setMenu(null);
    guardWebContents(child.webContents, log);
  });

  wc.on('will-navigate', (event, url) => {
    if (isWebUrl(url)) return;
    event.preventDefault();
    log.warn(`[browser] blocked navigation to a non-web URL: ${url.slice(0, 120)}`);
  });

  // `will-redirect` is the same check one step later: a server-side 3xx into `file://` never raises `will-navigate`.
  wc.on('will-redirect', (event, url) => {
    if (isWebUrl(url)) return;
    event.preventDefault();
    log.warn(`[browser] blocked redirect to a non-web URL: ${url.slice(0, 120)}`);
  });
};

/** The toolbar is ours and local: it never opens anything and never navigates. */
export const guardLocalWebContents = (wc: WebContents, log: AdapterLogger): void => {
  wc.setWindowOpenHandler(({ url }) => {
    log.warn(`[browser] toolbar tried to open a window: ${url.slice(0, 120)}`);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    // The dev server reloads the toolbar through a normal navigation; in a packaged build it is.
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) {
      return;
    }
    if (url.startsWith('file://')) return;
    event.preventDefault();
    log.warn(`[browser] toolbar tried to navigate: ${url.slice(0, 120)}`);
  });
};

/** Re-exported for the one caller that opens a URL the *user* clicked. */
export const openExternalIfWeb = (url: string): void => {
  if (isWebUrl(url)) void shell.openExternal(url);
};

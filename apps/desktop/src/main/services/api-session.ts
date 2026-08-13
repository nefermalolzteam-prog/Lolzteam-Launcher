import type { ProxyEntry } from '@shared-types';
import { net, type Session, session } from 'electron';
import log from 'electron-log/main';
import { redactSecrets } from '../lib/redact';
import { getSettings, onSettingsChange } from '../settings/settings-store';
import {
  applyProxyToSession,
  clearProxyFromSession,
  proxyLoginFor,
  proxyRulesFor,
  syncProxyCreds,
} from './proxy';

export const APP_PARTITION = 'persist:lolz-auth';

export const getAppSession = (): Session => session.fromPartition(APP_PARTITION);

const SKIP_REQUEST_HEADERS = new Set(['host', 'content-length', 'connection']);

/** A ceiling on what one answer may occupy in the main process. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export const appFetch = (async (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: RequestInit,
): Promise<Response> => {
  await whenAppProxyReady();
  assertProxyHonoured();

  const request = input instanceof Request && !init ? input : new Request(input as never, init);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const bodyBuf = hasBody ? Buffer.from(await request.clone().arrayBuffer()) : undefined;

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = net.request({
      method: request.method,
      url: request.url,
      session: getAppSession(),
      useSessionCookies: false,
    });

    request.headers.forEach((value, key) => {
      if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) req.setHeader(key, value);
    });

    req.on('login', (authInfo, cb) => {
      const creds = authInfo.isProxy ? proxyLoginFor(authInfo.host, authInfo.port) : null;
      if (creds) cb(creds.username, creds.password);
      else cb();
    });

    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.abort();
          fail(new Error('Ответ сервера слишком большой'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        }
        resolve(
          new Response(chunks.length ? Buffer.concat(chunks) : null, {
            status: res.statusCode,
            statusText: res.statusMessage,
            headers,
          }),
        );
      });
      res.on('error', (err: Error) => fail(err));
    });

    req.on('error', (err: Error) => fail(err));

    const signal = request.signal;
    if (signal) {
      if (signal.aborted) {
        req.abort();
        fail(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          req.abort();
          fail(new DOMException('The operation was aborted.', 'AbortError'));
        },
        { once: true },
      );
    }

    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}) as typeof globalThis.fetch;

/** Every field that changes where a request actually goes, and nothing else. */
const proxySignature = (proxy: ProxyEntry | undefined): string =>
  proxy ? `${proxyRulesFor(proxy)}#${proxy.username ?? ''}:${proxy.password ?? ''}` : '';

let applied: string | null = null;

/** Set when the user asked for a proxy and the session did not take it. */
let proxyFailure: string | null = null;

/** Throws if traffic would leave outside the proxy the user selected. */
const assertProxyHonoured = (): void => {
  if (proxyFailure === null) return;
  throw new Error(
    `Запрос не отправлен: не удалось направить трафик через выбранный прокси (${proxyFailure}). Проверьте прокси в настройках или отключите его.`,
  );
};

const applyAppProxy = async (proxies: ProxyEntry[], appProxyId: string | null): Promise<void> => {
  const proxy = appProxyId ? proxies.find((p) => p.id === appProxyId) : undefined;
  const sig = proxySignature(proxy);
  if (sig === applied && proxyFailure === null) return;
  applied = sig;
  const ses = getAppSession();
  try {
    if (proxy) {
      await applyProxyToSession(ses, proxy);
      log.info(`[app-proxy] routing app traffic via ${proxy.host}:${proxy.port}`);
    } else {
      await clearProxyFromSession(ses);
      log.info('[app-proxy] app traffic direct (no proxy)');
    }
    proxyFailure = null;
  } catch (err) {
    applied = null;
    // Only a *chosen* proxy that failed blocks anything.
    proxyFailure = proxy ? redactSecrets(err instanceof Error ? err.message : String(err)) : null;
    log.warn('[app-proxy] failed to apply', err);
  }
};

let applyChain: Promise<void> = Promise.resolve();

export const whenAppProxyReady = (): Promise<void> => applyChain;

export const initAppProxy = async (): Promise<void> => {
  const s = await getSettings();
  syncProxyCreds(s.proxies);
  applyChain = applyAppProxy(s.proxies, s.appProxyId);
  await applyChain;
  onSettingsChange((next) => {
    syncProxyCreds(next.proxies);
    applyChain = applyChain.then(() => applyAppProxy(next.proxies, next.appProxyId));
  });
};

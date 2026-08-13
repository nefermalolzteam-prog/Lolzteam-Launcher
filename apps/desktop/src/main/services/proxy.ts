import type { ProxyTestResult } from '@shared-ipc';
import type { ProxyEntry } from '@shared-types';
import { net, type Session, app, session } from 'electron';
import log from 'electron-log/main';
import { redactSecrets } from '../lib/redact';

type ProxyCreds = { username: string; password: string };

const credsByHostPort = new Map<string, ProxyCreds>();

const hostPortKey = (host: string, port: number): string => `${host}:${port}`;

export const proxyRulesFor = (entry: Pick<ProxyEntry, 'host' | 'port' | 'protocol'>): string =>
  `${entry.protocol === 'https' ? 'https' : 'http'}://${entry.host}:${entry.port}`;

/** The same proxy as a single URL with credentials inline. */
export const proxyUrlFor = (entry: ProxyEntry): string => {
  const scheme = entry.protocol === 'https' ? 'https' : 'http';
  const auth = entry.username
    ? `${encodeURIComponent(entry.username)}:${encodeURIComponent(entry.password ?? '')}@`
    : '';
  return `${scheme}://${auth}${entry.host}:${entry.port}`;
};

const registerProxyCreds = (
  entry: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password'>,
): void => {
  if (entry.username) {
    credsByHostPort.set(hostPortKey(entry.host, entry.port), {
      username: entry.username,
      password: entry.password ?? '',
    });
  }
};

export const proxyLoginFor = (host: string, port: number): ProxyCreds | null =>
  credsByHostPort.get(hostPortKey(host, port)) ?? null;

export const syncProxyCreds = (proxies: ProxyEntry[]): void => {
  credsByHostPort.clear();
  for (const p of proxies) registerProxyCreds(p);
};

export const applyProxyToSession = async (ses: Session, entry: ProxyEntry): Promise<void> => {
  registerProxyCreds(entry);
  await ses.setProxy({ proxyRules: proxyRulesFor(entry) });
  await ses.closeAllConnections();
};

export const clearProxyFromSession = async (ses: Session): Promise<void> => {
  await ses.setProxy({ mode: 'direct' });
  await ses.closeAllConnections();
};

let authHandlerWired = false;

export const registerProxyAuthHandler = (): void => {
  if (authHandlerWired) return;
  authHandlerWired = true;

  app.on('login', (event, _webContents, _request, authInfo, callback) => {
    if (!authInfo.isProxy) return;
    const creds = credsByHostPort.get(hostPortKey(authInfo.host, authInfo.port));
    if (!creds) return;
    event.preventDefault();
    callback(creds.username, creds.password);
  });
};

const TEST_TIMEOUT_MS = 10_000;
const TEST_URL = 'https://api.ipify.org?format=json';
/** The answer is `{"ip":"…"}`. */
const TEST_MAX_BYTES = 64 * 1024;

/** Sessions for the probe, borrowed and returned. */
const idleTestSessions: Session[] = [];
let testSessionSeq = 0;

const borrowTestSession = (): Session =>
  idleTestSessions.pop() ?? session.fromPartition(`proxy-test-${++testSessionSeq}`);

const returnTestSession = async (ses: Session): Promise<void> => {
  try {
    await ses.setProxy({ mode: 'direct' });
    await ses.closeAllConnections();
    await ses.clearStorageData();
    idleTestSessions.push(ses);
  } catch (err) {
    // Not returned to the pool: a session whose proxy could not be cleared would send the next probe through the previous.
    log.warn('[proxy] could not reset a test session', err);
  }
};

export const testProxy = (
  input: Pick<ProxyEntry, 'host' | 'port' | 'username' | 'password' | 'protocol'>,
): Promise<ProxyTestResult> => {
  return new Promise<ProxyTestResult>((resolve) => {
    const ses = borrowTestSession();

    let req: Electron.ClientRequest | null = null;
    let settled = false;
    const finish = (result: ProxyTestResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void returnTestSession(ses);
      resolve(result);
    };

    const started = Date.now();
    const timer = setTimeout(() => {
      // `req` is still null when `setProxy` itself is what is taking too long.
      req?.abort();
      finish({ ok: false, message: 'Таймаут подключения' });
    }, TEST_TIMEOUT_MS);

    ses
      .setProxy({ proxyRules: proxyRulesFor(input) })
      .then(() => {
        if (settled) return;
        req = net.request({ session: ses, url: TEST_URL, useSessionCookies: false });

        req.on('login', (authInfo, cb) => {
          if (authInfo.isProxy && input.username) {
            cb(input.username, input.password ?? '');
          } else {
            cb();
          }
        });

        req.on('response', (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (c) => {
            size += c.length;
            // A proxy that answers with a stream instead of a page would otherwise be buffered whole, in the main process.
            if (size > TEST_MAX_BYTES) {
              req?.abort();
              finish({ ok: false, message: 'Некорректный ответ' });
              return;
            }
            chunks.push(c);
          });
          response.on('end', () => {
            const ms = Date.now() - started;
            try {
              const body = Buffer.concat(chunks).toString('utf8');
              const ip = (JSON.parse(body) as { ip?: string }).ip;
              if (response.statusCode === 200 && ip) {
                finish({ ok: true, ms, ip });
              } else {
                finish({ ok: false, message: `HTTP ${response.statusCode}` });
              }
            } catch {
              finish({ ok: false, message: 'Некорректный ответ' });
            }
          });
        });

        // `err.message` goes to the renderer and, through `ACTION_LOG_RECORD`, into the journal on disk.
        req.on('error', (err) => {
          log.warn('[proxy] test failed', err);
          finish({ ok: false, message: redactSecrets(err.message) });
        });

        req.end();
      })
      .catch((err: unknown) => {
        finish({
          ok: false,
          message: redactSecrets(err instanceof Error ? err.message : String(err)),
        });
      });
  });
};

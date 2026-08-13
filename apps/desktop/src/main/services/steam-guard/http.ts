import type { ProxyEntry } from '@shared-types';
import { net, type Session, session } from 'electron';
import { applyProxyToSession } from '../proxy';

const USER_AGENT = 'okhttp/3.12.12';
const TIMEOUT_MS = 20_000;

export interface GuardHttpRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  /** `name=value` pairs, as `steam-session` hands them over. */
  readonly cookies?: readonly string[];
  readonly body?: string;
  readonly proxy?: ProxyEntry | undefined;
  /** Extra headers, applied last so a caller can override the defaults. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface GuardHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** One in-memory session per route, so connections and TLS handshakes are reused without any of them ever seeing a cookie. */
const sessions = new Map<string, Promise<Session>>();

const sessionFor = (proxy?: ProxyEntry): Promise<Session> => {
  const key = proxy ? `p-${proxy.id}` : 'direct';
  const cached = sessions.get(key);
  if (cached) return cached;

  const created = (async () => {
    const ses = session.fromPartition(`steam-guard-${key}`);
    if (proxy) await applyProxyToSession(ses, proxy);
    else await ses.setProxy({ mode: 'direct' });
    return ses;
  })();
  sessions.set(key, created);
  return created;
};

export const guardHttp = async (request: GuardHttpRequest): Promise<GuardHttpResponse> => {
  const ses = await sessionFor(request.proxy);

  return new Promise<GuardHttpResponse>((resolve, reject) => {
    const req = net.request({
      session: ses,
      url: request.url,
      method: request.method ?? 'GET',
      useSessionCookies: false,
      // A 302 to the login page is how Steam says the session is dead.
      redirect: 'manual',
    });

    req.setHeader('User-Agent', USER_AGENT);
    if (request.cookies?.length) req.setHeader('Cookie', request.cookies.join('; '));
    if (request.method === 'POST') {
      req.setHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    }
    for (const [name, value] of Object.entries(request.headers ?? {})) req.setHeader(name, value);

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        try {
          req.abort();
        } catch {
          // already gone
        }
        reject(new Error('timeout'));
      });
    }, TIMEOUT_MS);

    req.on('login', (authInfo, callback) => {
      if (authInfo.isProxy && request.proxy?.username) {
        callback(request.proxy.username, request.proxy.password ?? '');
      } else {
        callback();
      }
    });

    req.on('redirect', (statusCode) => {
      finish(() => {
        req.abort();
        resolve({ status: statusCode, body: '' });
      });
    });

    req.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        finish(() =>
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
      response.on('error', (err: Error) => finish(() => reject(err)));
    });

    req.on('error', (err) => finish(() => reject(err)));

    if (request.body) req.write(request.body, 'utf8');
    req.end();
  });
};

import { spawn } from 'node:child_process';
import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails } from '@shared-types';
import { failLogin as fail } from '../_shared/fail';
import { type EaErrorCode, EaLoginError, performEaLogin } from './auth';
import { readCefAesKey, writeCefCookies } from './cookies';
import { extractEaCreds } from './extract';
import { findEaPaths } from './paths';
import { killEaProcesses, waitForEaExit } from './process';

export const eaAdapter: ServiceAdapter = {
  id: 'ea',
  displayName: 'EA Desktop',
  platforms: ['win32'],
  methods: ['native'],

  async probe(_method: LoginMethod, _ctx: AdapterContext): Promise<ProbeResult> {
    if (process.platform !== 'win32') {
      return { available: false, reason: 'Вход в EA Desktop доступен только на Windows' };
    }
    const paths = await findEaPaths();
    if (!paths) {
      return { available: false, reason: 'EA Desktop не найден в системе (проверьте установку)' };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method !== 'native') return fail('login.errors.ea-native-only', undefined, method);
    if (process.platform !== 'win32') return fail('login.errors.ea-windows-only');

    const paths = await findEaPaths();
    if (!paths) return fail('login.errors.ea-not-found');

    const creds = extractEaCreds(account);
    if (!creds) return fail('login.errors.ea-no-credentials');

    ctx.onProgress?.({ step: 'acquiring-token' });
    ctx.log.info(`[ea] performing OAuth login for item #${account.itemId}`);

    let session: { remid: string; sid?: string };
    try {
      session = await performEaLogin(
        creds.email,
        creds.password,
        ctx.fetchEmailCode
          ? async () => {
              ctx.onProgress?.({ step: 'awaiting-email-code' });
              ctx.log.info('[ea] fetching email code from market');
              ctx.onProgress?.({ step: 'fetching-email-code' });
              return ctx.fetchEmailCode!(account.itemId);
            }
          : undefined,
        ctx.abortSignal,
      );
    } catch (err) {
      if (ctx.abortSignal.aborted) return fail('login.errors.cancelled');
      if (err instanceof EaLoginError) {
        const EA_ERROR_KEYS: Partial<Record<EaErrorCode, string>> = {
          'bad-credentials': 'login.errors.ea-bad-credentials',
          'needs-2fa': 'login.errors.ea-needs-2fa',
          'bad-2fa-code': 'login.errors.ea-bad-2fa-code',
          'no-remid': 'login.errors.ea-no-remid',
        };
        const key = EA_ERROR_KEYS[err.code];
        return key ? fail(key) : fail('login.errors.ea-login-error', { detail: err.message });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return fail('login.errors.ea-login-error', { detail: msg });
    }

    if (ctx.abortSignal.aborted) return fail('login.errors.cancelled');

    ctx.onProgress?.({ step: 'killing-ea' });
    ctx.log.info('[ea] killing EA processes');
    await killEaProcesses();
    await waitForEaExit(5000);

    if (ctx.abortSignal.aborted) return fail('login.errors.cancelled');

    ctx.onProgress?.({ step: 'writing-ea-session' });
    ctx.log.info('[ea] writing session cookies to CEF database');

    let aesKey: Buffer;
    try {
      aesKey = await readCefAesKey(paths.localPrefsPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail('login.errors.ea-aes-read-failed', { detail: msg });
    }

    try {
      writeCefCookies(paths.cookiesDbPath, aesKey, session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail('login.errors.ea-session-write-failed', { detail: msg });
    }

    ctx.onProgress?.({ step: 'launching-ea' });
    ctx.log.info(`[ea] launching ${paths.exePath}`);
    const child = spawn(paths.exePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    return {
      ok: true,
      method: 'native',
      launchedPid: child.pid,
      message: { key: 'login.success.ea-native', params: { account: creds.email } },
    };
  },
};

import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails, ServiceId } from '@shared-types';
import { serviceLabel } from '@shared-types';
import { mailboxPairFor } from '../../services/mailbox';
import { failLogin as fail } from '../_shared/fail';
import { extractBrowserLogin } from './extract';
import { injectCookies, openBrowserWindow } from './shell-window';

const createBrowserAdapter = (id: ServiceId): ServiceAdapter => {
  const displayName = serviceLabel(id);
  return {
    id,
    displayName,
    platforms: ['win32', 'darwin', 'linux'] as const,
    methods: ['web'] as const,

    async probe(method: LoginMethod): Promise<ProbeResult> {
      if (method !== 'web') {
        return { available: false, reason: 'Поддерживается только вход через браузер' };
      }
      return { available: true };
    },

    async login(
      method: LoginMethod,
      account: AccountDetails,
      ctx: AdapterContext,
    ): Promise<LoginResult> {
      if (method !== 'web') return fail('login.errors.web-only', undefined, method);
      if (ctx.abortSignal.aborted) return fail('login.errors.cancelled', undefined, method);

      const data = extractBrowserLogin(account);
      if (!data) {
        const secrets = (account.secrets ?? {}) as Record<string, unknown>;
        const cookieKeys = Object.keys(secrets).filter(
          (k) => k === 'cookies' || k.endsWith('_cookies') || k === 'cookieKey',
        );
        ctx.log.warn(
          `[browser] no cookies for #${account.itemId} (category=${account.categoryRaw}); ` +
            `cookie-ish keys present: ${cookieKeys.length ? cookieKeys.join(', ') : 'none'}`,
        );
        return fail('login.errors.browser-no-cookies', undefined, method);
      }

      const partition = `persist:lzt-account-${account.itemId}`;

      ctx.onProgress?.({ step: 'injecting-cookies' });
      ctx.log.info(`[browser] injecting ${data.cookies.length} cookie(s) for #${account.itemId}`);
      await injectCookies(partition, data.cookies, ctx);

      if (ctx.abortSignal.aborted) return fail('login.errors.cancelled', undefined, method);

      ctx.onProgress?.({ step: 'launching-browser' });
      ctx.log.info(`[browser] opening ${data.landingUrl}`);
      const { windowId } = openBrowserWindow(
        partition,
        data.landingUrl,
        `${displayName} — ${account.title}`,
        ctx,
        { emailPassword: mailboxPairFor(account) ?? undefined },
      );

      return {
        ok: true,
        method,
        windowId,
        message: {
          key: 'login.success.browser-web',
          params: { service: displayName, account: account.title },
        },
      };
    },
  };
};

export const tiktokAdapter = createBrowserAdapter('tiktok');
export const instagramAdapter = createBrowserAdapter('instagram');

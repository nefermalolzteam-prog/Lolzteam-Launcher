import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails } from '@shared-types';
import { serviceLabel } from '@shared-types';
import type { WebContents } from 'electron';
import { mailboxPairFor } from '../../services/mailbox';
import { failLogin as fail } from '../_shared/fail';
import { extractBrowserLogin } from '../browser/extract';
import { injectCookies, openBrowserWindow } from '../browser/shell-window';
import { extractEmailCreds, resolveLlmCookies } from './extract';
import { type LlmProviderConfig, resolveLlmProvider } from './provider';

const loginViaBrowser = async (
  account: AccountDetails,
  provider: LlmProviderConfig,
  ctx: AdapterContext,
): Promise<LoginResult> => {
  let cookies: ReturnType<typeof resolveLlmCookies>;
  let landingUrl: string;
  if (provider.loginKind === 'session-cookie') {
    cookies = resolveLlmCookies(account, provider);
    landingUrl = provider.landingUrl ?? 'about:blank';
  } else {
    const bl = extractBrowserLogin(account);
    cookies = bl?.cookies ?? [];
    landingUrl = provider.landingUrl ?? bl?.landingUrl ?? 'about:blank';
  }

  if (cookies.length === 0)
    return fail(`У этого аккаунта нет кук для входа в ${provider.displayName}`, 'web');

  const partition = `persist:lzt-account-${account.itemId}`;
  ctx.onProgress?.({ step: 'injecting-cookies' });
  ctx.log.info(
    `[llm] injecting ${cookies.length} cookie(s) for #${account.itemId} (${provider.provider})`,
  );
  await injectCookies(partition, cookies, ctx);

  if (ctx.abortSignal.aborted) return fail('Вход отменён', 'web');

  ctx.onProgress?.({ step: 'launching-browser' });
  ctx.log.info(`[llm] opening ${landingUrl} (${provider.provider})`);
  const { windowId } = openBrowserWindow(
    partition,
    landingUrl,
    `${provider.displayName} — ${account.title}`,
    ctx,
    { emailPassword: mailboxPairFor(account) ?? undefined },
  );

  return {
    ok: true,
    method: 'web',
    windowId,
    message: `${provider.displayName} открыт под аккаунтом ${account.title}`,
  };
};

const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hostGuardFor = (provider: LlmProviderConfig): string => {
  const hosts = provider.autofillHosts ?? [];
  if (hosts.length === 0) return 'true';
  const alt = hosts.map((h) => `(^|\\.)${escapeRe(h)}$`).join('|');
  return `!new RegExp(${JSON.stringify(alt)}).test(location.hostname)`;
};

const buildAutofillScript = (
  provider: LlmProviderConfig,
  email: string,
  password: string,
): string => {
  const e = JSON.stringify(email);
  const p = JSON.stringify(password);
  return `(() => {
    if (${hostGuardFor(provider)}) return;
    if (window.__lztAutofill) return;
    window.__lztAutofill = true;
    const EMAIL = ${e}, PW = ${p};
    const bad = /google|microsoft|apple|phone|passkey|sso|\\bwith\\b/i;
    const setVal = (el, val) => {
      try { el.focus(); } catch (_) {}
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (desc && desc.set) desc.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    };
    const clickSubmit = () => {
      const btn = [...document.querySelectorAll('button[type=submit], input[type=submit]')]
        .find((b) => !bad.test(b.innerText || b.value || ''));
      if (btn) btn.click();
    };
    let emailDone = false, tries = 0;
    const timer = setInterval(() => {
      if (++tries > 40) return clearInterval(timer); // ~20s
      try {
        const pw = document.querySelector(
          'input[type=password], input[name=password], input[autocomplete=current-password]'
        );
        if (pw) {
          clearInterval(timer);
          if (!pw.value) { setVal(pw, PW); setTimeout(clickSubmit, 500); }
          return;
        }
        const email = document.querySelector(
          'input[type=email], input#email, input[name=email], input[name=username], input[autocomplete=username]'
        );
        if (email) {
          if (!emailDone && !email.value) { setVal(email, EMAIL); emailDone = true; setTimeout(clickSubmit, 600); }
          return;
        }
        // No form yet (chatgpt.com landing): advance to the login form.
        if (!emailDone) {
          const login = [...document.querySelectorAll('button, a')].find(
            (b) => /^(log ?in|sign ?in|войти)$/i.test((b.innerText || '').trim()) && !bad.test(b.innerText || '')
          );
          if (login) login.click();
        }
      } catch (_) {}
    }, 500);
  })()`;
};

const loginViaEmailFill = async (
  account: AccountDetails,
  provider: LlmProviderConfig,
  ctx: AdapterContext,
): Promise<LoginResult> => {
  const creds = extractEmailCreds(account);
  if (!creds)
    return fail(`У этого аккаунта нет email/пароля для входа в ${provider.displayName}`, 'web');

  const partition = `persist:lzt-account-${account.itemId}`;
  ctx.onProgress?.({ step: 'injecting-cookies' });
  await injectCookies(partition, [], ctx);

  if (ctx.abortSignal.aborted) return fail('Вход отменён', 'web');

  ctx.onProgress?.({ step: 'launching-browser' });
  ctx.log.info(`[llm] opening ${provider.landingUrl} for email autofill #${account.itemId}`);
  const script = buildAutofillScript(provider, creds.email, creds.password);
  const { windowId } = openBrowserWindow(
    partition,
    provider.landingUrl ?? 'about:blank',
    `${provider.displayName} — ${account.title}`,
    ctx,
    {
      onEachLoad: (site: WebContents) => void site.executeJavaScript(script).catch(() => {}),
      emailPassword: mailboxPairFor(account) ?? undefined,
    },
  );

  return {
    ok: true,
    method: 'web',
    windowId,
    message: `${provider.displayName} открыт под аккаунтом ${account.title}`,
  };
};

export const llmAdapter: ServiceAdapter = {
  id: 'llm',
  displayName: serviceLabel('llm'),
  platforms: ['win32', 'darwin', 'linux'] as const,
  methods: ['web'] as const,

  async probe(method: LoginMethod): Promise<ProbeResult> {
    if (method === 'web') return { available: true };
    return { available: false, reason: 'Поддерживается только вход через браузер' };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method !== 'web') return fail('Поддерживается только вход через браузер', method);
    if (ctx.abortSignal.aborted) return fail('Вход отменён', method);

    const provider = resolveLlmProvider(account);
    if (!provider) {
      ctx.log.warn(
        `[llm] unsupported provider for #${account.itemId} ` +
          `(category=${account.categoryRaw}, title=${account.title})`,
      );
      return fail('Этот LLM-сервис пока не поддерживается', method);
    }

    return provider.loginKind === 'email-fill'
      ? loginViaEmailFill(account, provider, ctx)
      : loginViaBrowser(account, provider, ctx);
  },
};

import { join } from 'node:path';
import type {
  AdapterContext,
  LocalizedText,
  LoginDetail,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { AccountDetails } from '@shared-types';
import { serviceLabel } from '@shared-types';
import { sleep } from '../../lib/sleep';
import { approveOwnLoginSession } from '../../services/steam-guard/approve';
import { getGuardRecord } from '../../services/steam-guard/session-store';
import { failLogin as fail } from '../_shared/fail';
import { injectCookies, openBrowserWindow } from '../browser/shell-window';
import { computeConnectCacheHdr, encryptConnectCacheToken } from './connect-cache';
import { launchSteam, shutdownSteam } from './control';
import { extractSteamCreds } from './extract';
import { userConfigDir } from './layout';
import { findSteamInstall } from './paths';
import { setAutoLoginUser } from './registry';
import { type SessionError, acquireRefreshToken, acquireWebSession } from './session';
import { steam64ToSteam32 } from './steamid';
import { mergeConfigVdf, mergeLocalVdf, mergeLoginUsersVdf, writeLocalConfigVdf } from './vdf';
import { webCookiesToInjectable } from './web-cookies';

type Acquire<D> = (p: {
  login: string;
  password: string;
  sharedSecret: string | null;
  guardCode?: string;
  emailCode?: string;
  approveDeviceConfirm?: (clientId: string, steamId: string) => Promise<boolean>;
}) => Promise<{ ok: true; data: D } | { ok: false; error: SessionError }>;

const deviceConfirmApprover =
  (account: AccountDetails, ctx: AdapterContext) =>
  async (clientId: string, steamId: string): Promise<boolean> => {
    ctx.onProgress?.({ step: 'approving-device-confirm' });
    ctx.log.info(`[steam] approving own login for item #${account.itemId} via Guard`);
    const result = await approveOwnLoginSession(account.itemId, clientId, steamId);
    if (result.ok) return true;
    ctx.log.info(`[steam] Guard cannot approve this login: ${result.reason}`);
    return false;
  };

type SessionOutcome<D> = { ok: true; data: D } | { ok: false; error: LocalizedText };

const stop = (key: string, detail?: string): { ok: false; error: LocalizedText } => ({
  ok: false,
  error: detail === undefined ? { key } : { key, params: { detail } },
});

const resolveSession = async <D>(
  account: AccountDetails,
  ctx: AdapterContext,
  creds: { login: string; password: string; sharedSecret: string | null },
  acquire: Acquire<D>,
): Promise<SessionOutcome<D>> => {
  const withApproval = { ...creds, approveDeviceConfirm: deviceConfirmApprover(account, ctx) };
  let session = await acquire(withApproval);
  if (session.ok) return session;

  switch (session.error.kind) {
    case 'needs-email-code': {
      if (!ctx.fetchEmailCode) return stop('login.errors.steam-needs-email-code');
      for (let attempt = 0; ; attempt++) {
        ctx.onProgress?.({ step: 'awaiting-email-code' });
        ctx.log.info('[steam] fetching email code from market');
        ctx.onProgress?.({ step: 'fetching-email-code' });
        const code = await ctx.fetchEmailCode(account.itemId);
        if (!code) return stop('login.errors.steam-email-code-fetch-failed');
        ctx.log.info(`[steam] retrying with email code (attempt ${attempt + 1})`);
        ctx.onProgress?.({ step: 'acquiring-token', detailKey: 'with-email-code' });
        session = await acquire({ ...withApproval, emailCode: code });
        if (session.ok) return session;
        const rejected = errMsg(session.error);
        // The stale-code retry keys off Steam's own upstream text, not ours.
        const stale = /InvalidLoginAuthCode/i.test(rejected);
        if (!stale || attempt >= 1 || ctx.abortSignal.aborted)
          return stop('login.errors.steam-email-code-rejected', rejected);
        ctx.log.warn('[steam] email code was stale, waiting for the next one');
        ctx.onProgress?.({ step: 'awaiting-email-code' });
        await sleep(8000, ctx.abortSignal);
      }
    }
    case 'needs-totp': {
      if (ctx.fetchSteamGuardCode) {
        ctx.onProgress?.({ step: 'acquiring-token', detailKey: 'requesting-guard-code' });
        ctx.log.info('[steam] fetching one-time Guard code from market');
        const answer = await ctx.fetchSteamGuardCode(account.itemId);
        if (answer.noMafile) return stop('login.errors.steam-guard-no-mafile');
        if (answer.code) {
          ctx.onProgress?.({ step: 'acquiring-token', detailKey: 'guard-from-market' });
          session = await acquire({ ...withApproval, guardCode: answer.code });
          if (session.ok) return session;
          ctx.log.warn(`[steam] market Guard code rejected: ${errMsg(session.error)}`);
        }
      }

      if (!ctx.fetchSteamMafile) return stop('login.errors.steam-guard-mafile-unavailable');
      const allowed = ctx.confirmMafileDownload
        ? await ctx.confirmMafileDownload(account.itemId)
        : true;
      if (!allowed) return stop('login.errors.steam-mafile-declined');
      // Downloading the maFile is what cancels the item's guarantee, so it runs only past the user's yes above.
      ctx.log.info('[steam] fetching mafile for TOTP guard (guarantee dropped with consent)');
      const sharedSecret = await ctx.fetchSteamMafile(account.itemId);
      if (!sharedSecret) return stop('login.errors.steam-mafile-fetch-failed');
      ctx.log.info('[steam] retrying with mafile TOTP');
      ctx.onProgress?.({ step: 'acquiring-token', detailKey: 'guard-from-mafile' });
      session = await acquire({ ...withApproval, sharedSecret });
      if (!session.ok) return stop('login.errors.steam-guard-rejected', errMsg(session.error));
      return session;
    }
    case 'needs-device-confirm':
      return stop('login.errors.steam-needs-device-confirm');
    case 'needs-email-confirm':
      return stop('login.errors.steam-needs-email-confirm');
    case 'bad-credentials':
      return stop('login.errors.steam-bad-credentials', session.error.message);
    default:
      return stop('login.errors.steam-login-error', errMsg(session.error));
  }
};

const errMsg = (error: SessionError): string =>
  error.kind === 'unknown' || error.kind === 'bad-credentials' ? error.message : error.kind;

const GUARD_SOURCE_DETAIL: Record<GuardSource, LoginDetail | null> = {
  item: 'guard-from-item',
  sda: 'guard-from-sda',
  none: null,
};

type GuardSource = 'item' | 'sda' | 'none';

const withLocalGuardSecret = async (
  creds: { login: string; password: string; sharedSecret: string | null },
  itemId: number,
): Promise<{
  creds: { login: string; password: string; sharedSecret: string | null };
  source: GuardSource;
}> => {
  if (creds.sharedSecret) return { creds, source: 'item' };
  try {
    const secret = (await getGuardRecord(itemId))?.sharedSecret;
    if (secret) return { creds: { ...creds, sharedSecret: secret }, source: 'sda' };
  } catch {
    // No local base or no record — fall through to the market paths below.
  }
  return { creds, source: 'none' };
};

export const steamAdapter: ServiceAdapter = {
  id: 'steam',
  displayName: serviceLabel('steam'),
  platforms: ['win32', 'linux', 'darwin'] as const,
  methods: ['native', 'web'] as const,

  async probe(method: LoginMethod): Promise<ProbeResult> {
    if (method === 'web') return { available: true };
    if (method !== 'native') {
      return { available: false, reason: 'Поддерживается вход в клиент Steam или через браузер' };
    }
    if (!NATIVE_PLATFORMS.has(process.platform)) {
      return { available: false, reason: 'Вход в клиент Steam доступен на Windows, Linux и macOS' };
    }
    if (!(await findSteamInstall())) {
      return { available: false, reason: 'Steam не найден в системе (проверьте установку)' };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method === 'web') return loginViaBrowser(account, ctx);
    if (method !== 'native') return fail('Only native login supported', method);
    return loginNative(account, ctx);
  },
};

const loginViaBrowser = async (
  account: AccountDetails,
  ctx: AdapterContext,
): Promise<LoginResult> => {
  if (ctx.abortSignal.aborted) return fail('login.errors.cancelled', undefined, 'web');

  const creds = extractSteamCreds(account);
  if (!creds) return fail('login.errors.steam-no-credentials', undefined, 'web');
  const { creds: credsWithGuard, source: guardSource } = await withLocalGuardSecret(
    creds,
    account.itemId,
  );

  ctx.onProgress?.({
    step: 'acquiring-token',
    ...(GUARD_SOURCE_DETAIL[guardSource] ? { detailKey: GUARD_SOURCE_DETAIL[guardSource] } : {}),
  });
  ctx.log.info(`[steam] acquiring web session for item #${account.itemId}`);
  const session = await resolveSession(account, ctx, credsWithGuard, acquireWebSession);
  if (!session.ok) return { ok: false, method: 'web', message: session.error };

  const cookies = webCookiesToInjectable(session.data.cookies);
  if (cookies.length === 0) return fail('login.errors.steam-no-web-cookies', undefined, 'web');

  if (ctx.abortSignal.aborted) return fail('login.errors.cancelled', undefined, 'web');

  const partition = `persist:lzt-account-${account.itemId}`;
  ctx.onProgress?.({ step: 'injecting-cookies' });
  ctx.log.info(`[steam] injecting ${cookies.length} web cookie(s) for #${account.itemId}`);
  await injectCookies(partition, cookies, ctx);

  if (ctx.abortSignal.aborted) return fail('login.errors.cancelled', undefined, 'web');

  ctx.onProgress?.({ step: 'launching-browser' });
  const landingUrl = 'https://steamcommunity.com/my';
  ctx.log.info(`[steam] opening ${landingUrl}`);
  const { windowId } = openBrowserWindow(partition, landingUrl, `Steam — ${account.title}`, ctx);

  return {
    ok: true,
    method: 'web',
    windowId,
    message: { key: 'login.success.steam-web', params: { account: account.title } },
  };
};

const NATIVE_PLATFORMS = new Set<NodeJS.Platform>(['win32', 'linux', 'darwin']);

const loginNative = async (account: AccountDetails, ctx: AdapterContext): Promise<LoginResult> => {
  if (!NATIVE_PLATFORMS.has(process.platform)) {
    return fail('login.errors.steam-native-platform');
  }

  const install = await findSteamInstall();
  if (!install) return fail('login.errors.steam-not-found');
  const { layout } = install;

  const creds = extractSteamCreds(account);
  if (!creds) return fail('login.errors.steam-no-credentials');
  const { creds: credsWithGuard, source: guardSource } = await withLocalGuardSecret(
    creds,
    account.itemId,
  );

  ctx.onProgress?.({
    step: 'acquiring-token',
    ...(GUARD_SOURCE_DETAIL[guardSource] ? { detailKey: GUARD_SOURCE_DETAIL[guardSource] } : {}),
  });
  ctx.log.info(`[steam] acquiring refresh token for item #${account.itemId}`);
  const resolved = await resolveSession(account, ctx, credsWithGuard, acquireRefreshToken);
  if (!resolved.ok) return { ok: false, method: 'native', message: resolved.error };
  const session = resolved;

  const { refreshToken, steamId, accountName } = session.data;
  const login = accountName || creds.login;
  const steamId32 = steam64ToSteam32(steamId);

  ctx.onProgress?.({ step: 'killing-steam' });
  ctx.log.info(`[steam] stopping Steam (${layout.flavor})`);
  if (!(await shutdownSteam(install, ctx.log))) {
    return fail('login.errors.steam-not-closed');
  }

  ctx.onProgress?.({ step: 'writing-vdf' });
  ctx.log.info('[steam] merging VDF files');
  try {
    await writeLocalConfigVdf(
      join(userConfigDir(layout, steamId32), 'localconfig.vdf'),
      ctx.settings?.steamInvisible ?? false,
    );
    await mergeConfigVdf(join(layout.configDir, 'config.vdf'), login, steamId);
    await mergeLoginUsersVdf(
      join(layout.configDir, 'loginusers.vdf'),
      login,
      steamId,
      layout.flavor,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log.error('[steam] VDF merge aborted', err);
    return fail('login.errors.steam-vdf-failed', { detail: msg });
  }

  ctx.onProgress?.({ step: 'encrypting-token' });
  ctx.log.info(`[steam] encrypting refresh token (${layout.flavor})`);
  let encryptedHex: string;
  try {
    encryptedHex = await encryptConnectCacheToken(layout, refreshToken, login);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail('login.errors.steam-encrypt-failed', { detail: msg });
  }

  const hdr = computeConnectCacheHdr(login);
  try {
    await mergeLocalVdf(layout.localVdfPath, hdr, encryptedHex);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log.error('[steam] local.vdf merge aborted', err);
    return fail('login.errors.steam-localvdf-failed', { detail: msg });
  }

  ctx.log.info('[steam] setting AutoLoginUser');
  try {
    await setAutoLoginUser(layout, login);
  } catch (err) {
    ctx.log.warn('[steam] failed to update autologin setting', err);
  }

  const autoAppId =
    ctx.settings?.steamAutoLaunchGame && /^\d+$/.test(ctx.settings.steamAutoLaunchAppId ?? '')
      ? ctx.settings.steamAutoLaunchAppId
      : null;
  const launchTarget = autoAppId
    ? `steam://rungameid/${autoAppId}`
    : layout.flavor === 'win32'
      ? 'steam://0'
      : null;

  ctx.onProgress?.({ step: 'launching-steam' });
  ctx.log.info(`[steam] launching via ${launchTarget ?? install.launcher.command}`);
  const child = launchSteam(install, launchTarget);

  return {
    ok: true,
    method: 'native',
    launchedPid: child.pid,
    message: { key: 'login.success.steam-native', params: { account: login } },
  };
};

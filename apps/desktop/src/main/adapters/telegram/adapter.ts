import { rename, rm } from 'node:fs/promises';
import type {
  AdapterContext,
  LoginMethod,
  LoginResult,
  ProbeResult,
  ServiceAdapter,
} from '@adapter-contract';
import type { StringSessionData } from '@mtcute/node/utils.js';
import type { AccountDetails } from '@shared-types';
import { serviceLabel } from '@shared-types';
import { type WebContents, app } from 'electron';
import { fetchSelfId } from '../../services/telegram/self';
import {
  TELEGRAM_WEB_URL,
  buildWebAStorage,
  buildWebInjectionScript,
} from '../../services/telegram/web-login';
import { failLogin as fail } from '../_shared/fail';
import { injectCookies, openBrowserWindow } from '../browser/shell-window';
import { looksLikeFlatpakTelegram, looksLikeSwiftTelegram, resolveTelegramBinary } from './detect';
import { type TelegramCreds, extractTelegramCreds } from './extract';
import { type TelegramTarget, launchTelegram, resolveTelegramTarget } from './launch';
import { ensurePortableMarker, fileExists } from './paths';
import { killTelegramProcesses, waitForTelegramExit } from './process';
import { buildOfflineSession } from './session';
import { writeProxySettings } from './settings-tdf';
import { mergeSessions, readExistingSessions, toSessionData, writeTdata } from './tdata';

const loginViaWeb = async (
  account: AccountDetails,
  creds: TelegramCreds,
  ctx: AdapterContext,
): Promise<LoginResult> => {
  const authKey = creds.authKey;
  if (!authKey) return fail('login.errors.tg-no-web-session', undefined, 'web');

  let userId = creds.userId;
  if (!userId) {
    ctx.onProgress?.({ step: 'fetching-credentials' });
    ctx.log.info(`[telegram] no user id on #${account.itemId}, asking Telegram over the auth key`);
    try {
      userId = await fetchSelfId({
        session: buildOfflineSession({
          authKeyHex: authKey.authKeyHex,
          dcId: authKey.dcId,
          userId: null,
        }),
        apiId: creds.apiId,
        apiHash: creds.apiHash,
        deviceModel: creds.deviceModel,
        proxy: ctx.proxy ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.warn(`[telegram] could not resolve user id for #${account.itemId}: ${msg}`);
      return fail('login.errors.tg-userid-failed', { detail: msg }, 'web');
    }
  }

  let script: string;
  try {
    script = buildWebInjectionScript(
      buildWebAStorage({ authKeyHex: authKey.authKeyHex, dcId: authKey.dcId, userId }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail('login.errors.tg-web-session-failed', { detail: msg }, 'web');
  }

  const partition = `persist:lzt-account-${account.itemId}`;
  ctx.onProgress?.({ step: 'injecting-cookies' });
  await injectCookies(partition, [], ctx);

  if (ctx.abortSignal.aborted) return fail('login.errors.cancelled', undefined, 'web');

  ctx.onProgress?.({ step: 'launching-browser' });
  ctx.log.info(`[telegram] opening Telegram Web for #${account.itemId} (dc=${authKey.dcId})`);
  const { windowId } = openBrowserWindow(
    partition,
    TELEGRAM_WEB_URL,
    `Telegram — ${account.title}`,
    ctx,
    { plantBeforeScripts: (site: WebContents) => site.executeJavaScript(script) },
  );

  const who = creds.phone || `аккаунт #${account.itemId}`;
  return {
    ok: true,
    method: 'web',
    windowId,
    message: { key: 'login.success.tg-web', params: { account: who } },
  };
};

const NATIVE_PLATFORMS = new Set<NodeJS.Platform>(['win32', 'linux', 'darwin']);

// Platform-specific keys (the renderer resolves them); the two branches map the
// same slots to different phrasings. Empty string = «not applicable here».
const MSG =
  process.platform === 'win32'
    ? {
        missing: 'login.errors.tg-path-missing-win',
        notAtPath: 'login.errors.tg-not-at-path-win',
        flatpak: '',
        swift: '',
        sessionDirUnwritable: 'login.errors.tg-dir-unwritable-win',
        stillRunning: 'login.errors.tg-still-running-win',
      }
    : {
        missing: 'login.errors.tg-missing-nix',
        notAtPath: 'login.errors.tg-not-at-path-nix',
        flatpak: 'login.errors.tg-flatpak',
        swift: 'login.errors.tg-swift',
        sessionDirUnwritable: 'login.errors.tg-dir-unwritable-nix',
        stillRunning: 'login.errors.tg-still-running-nix',
      };

export const telegramAdapter: ServiceAdapter = {
  id: 'telegram',
  displayName: serviceLabel('telegram'),
  platforms: ['win32', 'linux', 'darwin'] as const,
  methods: ['native', 'web'] as const,

  async probe(method: LoginMethod, ctx: AdapterContext): Promise<ProbeResult> {
    if (method === 'web') return { available: true };
    if (method !== 'native') {
      return { available: false, reason: 'Поддерживается вход через Telegram Desktop или браузер' };
    }
    if (!NATIVE_PLATFORMS.has(process.platform)) {
      return {
        available: false,
        reason: 'Вход в Telegram Desktop доступен на Windows, Linux и macOS',
      };
    }
    const exe = resolveTelegramBinary(ctx.settings?.telegramExePath);
    if (!exe) return { available: false, reason: MSG.missing };
    if (!(await fileExists(exe))) return { available: false, reason: MSG.notAtPath };
    if (process.platform === 'linux' && (await looksLikeFlatpakTelegram(exe))) {
      return { available: false, reason: MSG.flatpak };
    }
    if (process.platform === 'darwin' && looksLikeSwiftTelegram(exe)) {
      return { available: false, reason: MSG.swift };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method !== 'native' && method !== 'web') {
      return fail('login.errors.tg-method-unsupported', undefined, method);
    }
    if (ctx.abortSignal.aborted) return fail('login.errors.cancelled', undefined, method);

    const creds = extractTelegramCreds(account);
    if (!creds) return fail('login.errors.tg-no-credentials', undefined, method);

    if (!creds.authKey) {
      return fail('login.errors.tg-no-restore-data', undefined, method);
    }

    if (method === 'web') return loginViaWeb(account, creds, ctx);

    if (!NATIVE_PLATFORMS.has(process.platform)) {
      return fail('login.errors.tg-native-platform');
    }

    const exe = resolveTelegramBinary(ctx.settings?.telegramExePath);
    if (!exe) return fail(MSG.missing);
    if (!(await fileExists(exe))) return fail(MSG.notAtPath);
    if (process.platform === 'linux' && (await looksLikeFlatpakTelegram(exe))) {
      return fail(MSG.flatpak);
    }
    if (process.platform === 'darwin' && looksLikeSwiftTelegram(exe)) {
      return fail(MSG.swift);
    }

    ctx.onProgress?.({ step: 'building-tdata' });
    let session: StringSessionData;
    try {
      session = buildOfflineSession({
        authKeyHex: creds.authKey.authKeyHex,
        dcId: creds.authKey.dcId,
        userId: creds.userId,
      });
      ctx.log.info(
        `[telegram] offline session built (dc=${creds.authKey.dcId}, userId=${creds.userId ?? 'none'})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail('login.errors.tg-session-build-failed', { detail: msg });
    }

    let target: TelegramTarget;
    try {
      target = await resolveTelegramTarget(exe, app.getPath('userData'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(MSG.sessionDirUnwritable, { detail: msg });
    }

    ctx.onProgress?.({ step: 'killing-telegram' });
    ctx.log.info(`[telegram] stopping Telegram instances on ${target.workdir}`);
    await killTelegramProcesses(target);
    const exited = await waitForTelegramExit(target, 5000);
    if (!exited) return fail(MSG.stillRunning);

    if (ctx.abortSignal.aborted) return fail('login.errors.cancelled');

    ctx.onProgress?.({ step: 'writing-tdata' });
    const tdataDir = target.tdataDir;
    const stagingDir = `${tdataDir}.new`;
    const backupDir = `${tdataDir}.bak`;
    if (!(await fileExists(tdataDir)) && (await fileExists(backupDir))) {
      try {
        await rename(backupDir, tdataDir);
        ctx.log.warn('[telegram] restored tdata from interrupted swap backup');
      } catch (err) {
        ctx.log.warn(`[telegram] failed to restore tdata backup: ${String(err)}`);
      }
    }
    // Preserve previously added accounts: read what's already in tdata, drop any
    // stale entry for this same user, prepend the new session (it becomes active)
    // and cap the total to the user-chosen limit (default 3; 0 = no limit for
    // third-party clients). Falls back to a single-account write if the existing
    // tdata can't be read (passcode/corruption/version), matching old behaviour.
    const maxAccounts = ctx.settings?.telegramMaxAccounts ?? 3;
    const incoming = toSessionData(session);
    const existing = await readExistingSessions(tdataDir, ctx.log);
    const merged = mergeSessions(incoming, existing, maxAccounts);
    ctx.log.info(`[telegram] writing tdata to ${tdataDir}: ${merged.length} account(s) (offline)`);
    try {
      await rm(stagingDir, { recursive: true, force: true });
      await writeTdata(merged, stagingDir);
      await rm(backupDir, { recursive: true, force: true });
      let hadBackup = false;
      try {
        await rename(tdataDir, backupDir);
        hadBackup = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      try {
        await rename(stagingDir, tdataDir);
      } catch (err) {
        if (hadBackup) await rename(backupDir, tdataDir).catch(() => {});
        throw err;
      }
      if (hadBackup) await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    } catch (err) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      const msg = err instanceof Error ? err.message : String(err);
      return fail('login.errors.tg-tdata-write-failed', { detail: msg });
    }

    if (ctx.proxy) {
      try {
        await writeProxySettings(tdataDir, ctx.proxy);
        ctx.log.info(`[telegram] proxy settings written: ${ctx.proxy.host}:${ctx.proxy.port}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`[telegram] failed to write proxy settings (continuing direct): ${msg}`);
      }
    }

    if (target.needsPortableMarker) {
      try {
        await ensurePortableMarker(exe);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail('login.errors.tg-portable-marker-failed', { detail: msg });
      }
    }

    if (ctx.abortSignal.aborted) return fail('login.errors.cancelled');

    ctx.onProgress?.({ step: 'launching-telegram' });
    ctx.log.info(`[telegram] launching ${exe} ${target.args.join(' ')}`);
    let child: Awaited<ReturnType<typeof launchTelegram>>;
    try {
      child = await launchTelegram(target, ctx.log);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail('login.errors.tg-launch-failed', { detail: msg });
    }

    const who = creds.phone || `аккаунт #${account.itemId}`;
    return {
      ok: true,
      method,
      launchedPid: child.pid,
      message: { key: 'login.success.tg-native', params: { account: who } },
    };
  },
};

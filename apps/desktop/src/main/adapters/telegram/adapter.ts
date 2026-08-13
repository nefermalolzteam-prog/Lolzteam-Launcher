import { spawn } from 'node:child_process';
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
import type { WebContents } from 'electron';
import { fetchSelfId } from '../../services/telegram/self';
import {
  TELEGRAM_WEB_URL,
  buildWebAStorage,
  buildWebInjectionScript,
} from '../../services/telegram/web-login';
import { failLogin as fail } from '../_shared/fail';
import { injectCookies, openBrowserWindow } from '../browser/shell-window';
import { type TelegramCreds, extractTelegramCreds } from './extract';
import { ensurePortableMarker, fileExists, getTdataDir } from './paths';
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
  if (!authKey) return fail('Нет данных сессии Telegram для входа через браузер', 'web');

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
      return fail(`Не удалось определить user id аккаунта: ${msg}`, 'web');
    }
  }

  let script: string;
  try {
    script = buildWebInjectionScript(
      buildWebAStorage({ authKeyHex: authKey.authKeyHex, dcId: authKey.dcId, userId }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Не удалось собрать сессию для Telegram Web: ${msg}`, 'web');
  }

  const partition = `persist:lzt-account-${account.itemId}`;
  ctx.onProgress?.({ step: 'injecting-cookies' });
  await injectCookies(partition, [], ctx);

  if (ctx.abortSignal.aborted) return fail('Вход отменён', 'web');

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
    message: `Telegram Web открыт под ${who}`,
  };
};

export const telegramAdapter: ServiceAdapter = {
  id: 'telegram',
  displayName: serviceLabel('telegram'),
  platforms: ['win32'] as const,
  methods: ['native', 'web'] as const,

  async probe(method: LoginMethod, ctx: AdapterContext): Promise<ProbeResult> {
    if (method === 'web') return { available: true };
    if (method !== 'native') {
      return { available: false, reason: 'Поддерживается вход через Telegram Desktop или браузер' };
    }
    if (process.platform !== 'win32') {
      return { available: false, reason: 'Telegram-адаптер работает только на Windows' };
    }
    const exe = ctx.settings?.telegramExePath;
    if (!exe) {
      return { available: false, reason: 'Укажите путь к Telegram.exe в Настройках' };
    }
    if (!(await fileExists(exe))) {
      return { available: false, reason: 'Telegram.exe не найден по указанному пути' };
    }
    return { available: true };
  },

  async login(
    method: LoginMethod,
    account: AccountDetails,
    ctx: AdapterContext,
  ): Promise<LoginResult> {
    if (method !== 'native' && method !== 'web') {
      return fail('Поддерживается вход через Telegram Desktop или браузер', method);
    }
    if (ctx.abortSignal.aborted) return fail('Вход отменён', method);

    const creds = extractTelegramCreds(account);
    if (!creds) return fail('У этого аккаунта нет данных Telegram в lzt.market', method);

    if (!creds.authKey) {
      return fail(
        'Нет данных сессии Telegram для восстановления (loginData.raw пуст или некорректен)',
        method,
      );
    }

    if (method === 'web') return loginViaWeb(account, creds, ctx);

    if (process.platform !== 'win32') return fail('Telegram-адаптер работает только на Windows');

    const exe = ctx.settings?.telegramExePath;
    if (!exe || !(await fileExists(exe))) {
      return fail('Укажите путь к Telegram.exe в Настройках');
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
      return fail(`Не удалось собрать сессию из auth_key: ${msg}`);
    }

    ctx.onProgress?.({ step: 'killing-telegram' });
    ctx.log.info('[telegram] killing Telegram processes');
    await killTelegramProcesses(exe);
    const exited = await waitForTelegramExit(exe, 5000);
    if (!exited) {
      return fail(
        'Telegram всё ещё запущен (возможно, от имени администратора). Закройте его вручную и повторите вход.',
      );
    }

    if (ctx.abortSignal.aborted) return fail('Вход отменён');

    ctx.onProgress?.({ step: 'writing-tdata' });
    let tdataDir: string;
    try {
      tdataDir = await getTdataDir(exe);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Папка с Telegram.exe недоступна на запись: ${msg}`);
    }
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
      return fail(`Не удалось записать сессию tdata: ${msg}`);
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

    // Without `tportable.tdat` next to the exe, Telegram Desktop reads
    // %APPDATA%\Telegram Desktop instead of our tdata and shows the phone-entry
    // screen — making the offline write look like it silently failed.
    try {
      await ensurePortableMarker(exe);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`Не удалось создать маркер portable-режима: ${msg}`);
    }

    if (ctx.abortSignal.aborted) return fail('Вход отменён');

    ctx.onProgress?.({ step: 'launching-telegram' });
    ctx.log.info('[telegram] launching portable Telegram');
    const child = spawn(exe, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    const who = creds.phone || `аккаунт #${account.itemId}`;
    return {
      ok: true,
      method,
      launchedPid: child.pid,
      message: `Telegram запущен под ${who}`,
    };
  },
};

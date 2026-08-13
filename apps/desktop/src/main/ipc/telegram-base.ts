import { IPC_CHANNELS } from '@shared-ipc';
import type {
  TelegramAvatarPack,
  TelegramCheckRequest,
  TelegramCleanupRequest,
  TelegramConvertRunResult,
  TelegramConvertScan,
  TelegramConvertTarget,
  TelegramIdentifyResult,
  TelegramPrivacyKey,
  TelegramPrivacyRequest,
  TelegramPrivacyValue,
  TelegramProfile,
  TelegramProfileRequest,
  TelegramRunStart,
} from '@shared-types';
import { TELEGRAM_PRIVACY_KEYS } from '@shared-types';
import type { OpenDialogOptions } from 'electron';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import log from 'electron-log/main';
import {
  listTelegramProfiles,
  readTelegramAvatar,
  saveTelegramProfile,
} from '../accounts/telegram-profile-store';
import { AvatarPool, scanAvatarPack } from '../services/telegram/avatar-pack';
import { checkTelegramAccount } from '../services/telegram/checker';
import { cleanupTelegramAccount } from '../services/telegram/cleanup';
import { runConvert, scanConvertFolder } from '../services/telegram/convert';
import { identifyTelegramSource } from '../services/telegram/import';
import { NameGenerator } from '../services/telegram/names';
import { applyTelegramPrivacy } from '../services/telegram/privacy';
import { fillTelegramProfile } from '../services/telegram/profile';
import { cancelTelegramRun, startTelegramRun } from '../services/telegram/runner';
import { handleAction } from './handle-action';

/** The «База» surface, exposed to the renderer: the offline converter, and the mass operations that do talk to Telegram. */
export const registerTelegramIpc = (): void => {
  const pick = async (
    event: Electron.IpcMainInvokeEvent,
    options: OpenDialogOptions,
  ): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  };

  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_CONVERT_PICK_DIR,
    async (event, opts: { title?: string } = {}): Promise<{ dir: string | null }> => ({
      dir: await pick(event, {
        title: opts.title,
        properties: ['openDirectory', 'createDirectory'],
      }),
    }),
  );

  /** A session lives in a file or in a folder, and Windows refuses to offer both in one dialog. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_PICK_PATH,
    async (
      event,
      opts: { title?: string; mode?: 'file' | 'dir' } = {},
    ): Promise<{ path: string | null }> => ({
      path: await pick(event, {
        title: opts.title,
        properties: opts.mode === 'dir' ? ['openDirectory'] : ['openFile'],
      }),
    }),
  );

  /** Works out what a pasted string or a picked path holds, for the add-account form. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_IDENTIFY,
    async (_e, opts: { text?: string; path?: string } = {}): Promise<TelegramIdentifyResult> => {
      try {
        const result = await identifyTelegramSource({
          ...(typeof opts.text === 'string' ? { text: opts.text } : {}),
          ...(typeof opts.path === 'string' ? { path: opts.path } : {}),
        });
        if (!result.ok) log.info(`[telegram/identify] ${result.reason}`);
        return result;
      } catch (err) {
        log.warn('[telegram/identify] failed', err);
        return { ok: false, reason: 'unreadable' };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_CONVERT_SCAN,
    async (_e, { dir }: { dir: string }): Promise<TelegramConvertScan> => {
      try {
        const scan = await scanConvertFolder(dir);
        log.info(`[telegram/convert] scanned ${dir}: ${scan.entries.length} entries`);
        return scan;
      } catch (err) {
        log.warn(`[telegram/convert] scan failed for ${dir}: ${String(err)}`);
        return { dir, entries: [], skipped: 0 };
      }
    },
  );

  handleAction(
    IPC_CHANNELS.TELEGRAM_CONVERT_RUN,
    async (
      _e,
      params: {
        dir: string;
        ids: string[];
        target: TelegramConvertTarget;
        outDir: string;
        withJson: boolean;
      },
    ): Promise<TelegramConvertRunResult> => {
      try {
        const result = await runConvert(params);
        log.info(
          `[telegram/convert] ${params.target}: ${result.converted} converted, ${result.failed} failed → ${result.outDir}`,
        );
        return result;
      } catch (err) {
        // A failure this far out means the output folder itself was unusable.
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`[telegram/convert] run failed: ${message}`);
        return {
          outDir: params.outDir,
          items: params.ids.map((id) => ({
            id,
            name: id,
            ok: false,
            output: null,
            error: message,
          })),
          converted: 0,
          failed: params.ids.length,
        };
      }
    },
    {
      // The one «База» operation that finishes inside its own `invoke`: it is offline.
      action: 'telegram.convert',
      target: (p) => p?.target ?? null,
      // The engine reports per-item failures instead of throwing.
      status: (r) => (r.converted === 0 && r.failed > 0 ? 'fail' : null),
      detail: (r) => `${r.converted} converted, ${r.failed} failed`,
    },
  );

  /** Starts a liveness run over the selected accounts. */
  ipcMain.handle(IPC_CHANNELS.TELEGRAM_CHECK, (_e, req: TelegramCheckRequest): TelegramRunStart => {
    const avatars = new Map<number, Uint8Array | null>();
    const start = startTelegramRun(
      {
        kind: 'check',
        accountIds: req.accountIds,
        proxyIds: req.proxyIds ?? [],
        onSettled: (row) => {
          if (!row.check) return;
          // Absent from the map = nothing looked at the picture; the store reads that as "keep the one you have".
          const avatar = avatars.has(row.accountId) ? avatars.get(row.accountId) : undefined;
          avatars.delete(row.accountId);
          // Nobody waits for this write, so nobody would see it reject either.
          void saveTelegramProfile(row.accountId, row.check, avatar).catch((err: unknown) => {
            log.error(`[telegram/check] could not store the profile of ${row.accountId}`, err);
          });
        },
      },
      async (client, account, report) => {
        const { info, avatar } = await checkTelegramAccount(
          client,
          {
            withSpam: req.withSpam === true,
            withSessions: req.withSessions === true,
            withAvatar: req.withAvatar !== false,
          },
          report,
        );
        if (avatar !== undefined) avatars.set(account.accountId, avatar);
        return { check: info };
      },
    );
    if (start.ok) {
      log.info(
        `[telegram/check] run ${start.runId}: ${req.accountIds.length} accounts, spam=${req.withSpam === true}`,
      );
    }
    return start;
  });

  /** Calls off whatever is running, whichever service started it. */
  ipcMain.handle(IPC_CHANNELS.TASK_CANCEL, (_e, { runId }: { runId: string }): void => {
    cancelTelegramRun(runId);
  });

  /** What is in an avatar folder, for the modal to show before a run. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_AVATAR_PACK,
    (_e, { dir }: { dir: string }): Promise<TelegramAvatarPack> => scanAvatarPack(dir),
  );

  /** Starts a profile run: a generated name, bio and picture per account. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_PROFILE_FILL,
    async (_e, req: TelegramProfileRequest): Promise<TelegramRunStart> => {
      let avatars: AvatarPool | null = null;
      if (req.avatarDir) {
        avatars = await AvatarPool.open(req.avatarDir);
        if (!avatars) {
          log.warn(`[telegram/profile] no usable pictures in ${req.avatarDir}`);
          return { ok: false, reason: 'no_avatars' };
        }
      }

      const names = new NameGenerator(req.gender, req.locale);
      const faces = new Map<number, Uint8Array | null>();

      const start = startTelegramRun(
        {
          kind: 'profile',
          accountIds: req.accountIds,
          proxyIds: req.proxyIds ?? [],
          onSettled: (row) => {
            // A fill ends by reading the account back, so the same store the checker feeds is refreshed here too.
            if (!row.check) return;
            const avatar = faces.has(row.accountId) ? faces.get(row.accountId) : undefined;
            faces.delete(row.accountId);
            void saveTelegramProfile(row.accountId, row.check, avatar).catch((err: unknown) => {
              log.error(`[telegram/profile] could not store the profile of ${row.accountId}`, err);
            });
          },
        },
        async (client, account, report) => {
          const { fill, info, avatar } = await fillTelegramProfile(
            client,
            {
              names,
              withName: req.withName !== false,
              withBio: req.withBio === true,
              avatars,
              replaceAvatar: req.replaceAvatar === true,
            },
            report,
          );
          if (avatar !== undefined) faces.set(account.accountId, avatar);
          return { check: info, filled: fill };
        },
      );

      if (start.ok) {
        log.info(
          `[telegram/profile] run ${start.runId}: ${req.accountIds.length} accounts, ${req.gender}/${req.locale}, avatars=${req.avatarDir ? 'yes' : 'no'}`,
        );
      }
      return start;
    },
  );

  /** Starts a cleanup run: the previous owner's chats, groups, channels and contacts off the account. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_CLEANUP,
    (_e, req: TelegramCleanupRequest): TelegramRunStart => {
      const targets = [...new Set(req.targets ?? [])];
      if (targets.length === 0) return { ok: false, reason: 'empty' };

      const start = startTelegramRun(
        {
          kind: 'cleanup',
          accountIds: req.accountIds,
          proxyIds: req.proxyIds ?? [],
          onSettled: (row) => {
            // `undefined` for the avatar: nothing here looked at the picture, and the store reads that as "keep the one you have".
            if (row.check) void saveTelegramProfile(row.accountId, row.check, undefined);
          },
        },
        async (client, _account, report, signal, keepAlive) => {
          const { result, info } = await cleanupTelegramAccount(
            client,
            {
              targets,
              includeArchived: req.includeArchived === true,
              revokePrivate: req.revokePrivate === true,
            },
            report,
            signal,
            keepAlive,
          );
          return { check: info, cleaned: result };
        },
      );

      if (start.ok) {
        log.info(
          `[telegram/cleanup] run ${start.runId}: ${req.accountIds.length} accounts, ${targets.join('+')}, archived=${req.includeArchived === true}, revoke=${req.revokePrivate === true}`,
        );
      }
      return start;
    },
  );

  /** Starts a privacy run: the switches the user chose, written onto every selected account. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_PRIVACY,
    (_e, req: TelegramPrivacyRequest): TelegramRunStart => {
      const rules: Partial<Record<TelegramPrivacyKey, TelegramPrivacyValue>> = {};
      for (const key of TELEGRAM_PRIVACY_KEYS) {
        const value = req.rules?.[key];
        if (value) rules[key] = value;
      }
      const keys = Object.keys(rules);
      if (keys.length === 0) return { ok: false, reason: 'empty' };

      const start = startTelegramRun(
        {
          kind: 'privacy',
          accountIds: req.accountIds,
          proxyIds: req.proxyIds ?? [],
          onSettled: (row) => {
            if (row.check) void saveTelegramProfile(row.accountId, row.check, undefined);
          },
        },
        async (client, _account, report) => {
          const { result, info } = await applyTelegramPrivacy(client, rules, report);
          return { check: info, privacy: result };
        },
      );

      if (start.ok) {
        log.info(
          `[telegram/privacy] run ${start.runId}: ${req.accountIds.length} accounts, ${keys.join('+')}`,
        );
      }
      return start;
    },
  );

  /** Everything the last check learned, for the account list to draw itself with. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_PROFILES,
    (): Promise<TelegramProfile[]> => listTelegramProfiles(),
  );

  /** One avatar, as a `data:` URL. */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_AVATAR,
    (_e, { accountId }: { accountId: number }): Promise<string | null> =>
      readTelegramAvatar(accountId),
  );
};

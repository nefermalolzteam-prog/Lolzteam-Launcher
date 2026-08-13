import { IPC_CHANNELS } from '@shared-ipc';
import type {
  SteamCheckRecord,
  SteamCheckRequest,
  SteamFriendsRequest,
  SteamLinkRequest,
  TelegramRunStart,
} from '@shared-types';
import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { listSteamChecks } from '../accounts/steam-check-store';
import { clearSteamSession } from '../adapters/steam/clear-session';
import {
  startSteamCheckRun,
  startSteamFriendsRun,
  startSteamLinkRun,
} from '../services/steam/runner';
import { handleAction } from './handle-action';

export const registerSteamIpc = (): void => {
  handleAction(
    IPC_CHANNELS.STEAM_CLEAR_SESSION,
    async () => {
      log.info('[steam] clearing local session data');
      try {
        const result = await clearSteamSession();
        if (result.ok) log.info('[steam] session data cleared');
        else log.warn(`[steam] clear session skipped: ${result.message}`);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('[steam] clear session failed', err);
        return { ok: false, message };
      }
    },
    { action: 'steam.session.clear' },
  );

  /** Starts a validity run and answers with its id, not its result. */
  ipcMain.handle(IPC_CHANNELS.STEAM_CHECK, (_e, req: SteamCheckRequest): TelegramRunStart => {
    const start = startSteamCheckRun(req);
    if (start.ok) log.info(`[steam/check] run ${start.runId}: ${req.accountIds.length} accounts`);
    else log.info(`[steam/check] refused: ${start.reason}`);
    return start;
  });

  /** Empties the selected accounts' friends lists. */
  ipcMain.handle(IPC_CHANNELS.STEAM_FRIENDS, (_e, req: SteamFriendsRequest): TelegramRunStart => {
    const start = startSteamFriendsRun(req);
    if (start.ok) {
      log.info(
        `[steam/friends] run ${start.runId}: ${req.accountIds.length} accounts, ${req.targets.join('+')}${
          req.block ? ', blocking' : ''
        }`,
      );
    } else log.info(`[steam/friends] refused: ${start.reason}`);
    return start;
  });

  /** Attaches the authenticator to every selected account. */
  ipcMain.handle(IPC_CHANNELS.STEAM_LINK, (_e, req: SteamLinkRequest): TelegramRunStart => {
    const start = startSteamLinkRun(req);
    if (start.ok) log.info(`[steam/link] run ${start.runId}: ${req.accountIds.length} accounts`);
    else log.info(`[steam/link] refused: ${start.reason}`);
    return start;
  });

  /** Every verdict on disk, which is what the account list draws before a single account has been re-checked. */
  ipcMain.handle(IPC_CHANNELS.STEAM_CHECKS, async (): Promise<SteamCheckRecord[]> => {
    try {
      return await listSteamChecks();
    } catch (err) {
      log.error('[steam/check] could not read the stored verdicts', err);
      return [];
    }
  });
};

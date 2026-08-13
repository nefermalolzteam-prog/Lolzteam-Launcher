import { IPC_CHANNELS } from '@shared-ipc';
import type {
  GuardAuthSessionInfo,
  GuardCodeResult,
  GuardConfirmation,
  GuardConfirmationAction,
  GuardResult,
  GuardStatus,
  ScreenCapture,
} from '@shared-types';
import { ipcMain } from 'electron';
import { approveAuthSession, previewAuthSession } from '../services/steam-guard/approve';
import { actOnConfirmations, listConfirmations } from '../services/steam-guard/confirmations';
import { captureScreens } from '../services/steam-guard/screens';
import {
  getGuardCodeFor,
  getGuardStatus,
  linkGuardAccount,
  unlinkGuardAccount,
} from '../services/steam-guard/session';
import { handleAction } from './handle-action';

/** Account ids cross IPC as `unknown`; market ids are positive, local ones negative. */
const toAccountId = (payload?: { accountId?: unknown }): number => {
  const id = Number(payload?.accountId);
  if (!Number.isInteger(id) || id === 0) throw new Error('invalid account id');
  return id;
};

const toUrl = (payload?: { url?: unknown }): string =>
  typeof payload?.url === 'string' ? payload.url : '';

/** Confirmations come back from the renderer as it received them. */
const toItems = (payload?: { items?: unknown }): GuardConfirmation[] => {
  if (!Array.isArray(payload?.items)) return [];
  const items: GuardConfirmation[] = [];
  for (const raw of payload.items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<GuardConfirmation>;
    if (typeof item.id !== 'string' || typeof item.nonce !== 'string') continue;
    if (!item.id || !item.nonce) continue;
    items.push({
      id: item.id,
      nonce: item.nonce,
      creatorId: typeof item.creatorId === 'string' ? item.creatorId : '',
      type: Number.isFinite(item.type) ? Number(item.type) : 0,
      typeName: '',
      headline: '',
      summary: [],
      icon: '',
      warning: null,
      creationTime: 0,
    });
  }
  return items;
};

const toAction = (payload?: { action?: unknown }): GuardConfirmationAction =>
  // Anything but an explicit `allow` cancels — the safe direction to round to.
  payload?.action === 'allow' ? 'allow' : 'cancel';

/** The «подтвердить/отклонить» payload, named because it is written more than once. */
type ConfirmActPayload = { accountId?: unknown; action?: unknown; items?: unknown };

export const registerSteamGuardIpc = (): void => {
  ipcMain.handle(
    IPC_CHANNELS.STEAM_GUARD_STATUS,
    async (_e, payload?: { accountId?: unknown }): Promise<GuardStatus> =>
      getGuardStatus(toAccountId(payload)),
  );

  handleAction(
    IPC_CHANNELS.STEAM_GUARD_LINK,
    async (
      _e,
      payload?: { accountId?: unknown; proxyId?: unknown; emailCode?: unknown },
    ): Promise<GuardResult<{ status: GuardStatus }>> => {
      const accountId = toAccountId(payload);
      const result = await linkGuardAccount(accountId, {
        proxyId: typeof payload?.proxyId === 'string' ? payload.proxyId : null,
        ...(typeof payload?.emailCode === 'string' && payload.emailCode
          ? { emailCode: payload.emailCode }
          : {}),
      });
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason,
          ...(result.message ? { message: result.message } : {}),
        };
      }
      return { ok: true, status: await getGuardStatus(accountId) };
    },
    { action: 'guard.link', itemId: (p?: { accountId?: unknown }) => Number(p?.accountId) || null },
  );

  handleAction(
    IPC_CHANNELS.STEAM_GUARD_UNLINK,
    async (_e, payload?: { accountId?: unknown }): Promise<{ ok: boolean }> => ({
      ok: await unlinkGuardAccount(toAccountId(payload)),
    }),
    {
      action: 'guard.unlink',
      itemId: (p?: { accountId?: unknown }) => Number(p?.accountId) || null,
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.STEAM_GUARD_CODE,
    async (
      _e,
      payload?: { accountId?: unknown },
    ): Promise<GuardResult<{ code: GuardCodeResult }>> => {
      const result = await getGuardCodeFor(toAccountId(payload));
      return result.ok ? { ok: true, code: result.code } : { ok: false, reason: result.reason };
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.STEAM_GUARD_SESSION_INFO,
    async (
      _e,
      payload?: { accountId?: unknown; url?: unknown },
    ): Promise<GuardResult<{ info: GuardAuthSessionInfo }>> => {
      const result = await previewAuthSession(toAccountId(payload), toUrl(payload));
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason,
          ...(result.message ? { message: result.message } : {}),
        };
      }
      return { ok: true, info: result.data };
    },
  );

  handleAction(
    IPC_CHANNELS.STEAM_GUARD_APPROVE,
    async (
      _e,
      payload?: { accountId?: unknown; url?: unknown; approve?: unknown },
    ): Promise<GuardResult<{ approved: boolean }>> => {
      // Approval is opt-in per press: anything but an explicit `true` denies.
      const approve = payload?.approve === true;
      const result = await approveAuthSession(toAccountId(payload), toUrl(payload), approve);
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason,
          ...(result.message ? { message: result.message } : {}),
        };
      }
      return { ok: true, approved: result.data.approved };
    },
    {
      action: 'guard.approve',
      itemId: (p?: { accountId?: unknown }) => Number(p?.accountId) || null,
      // Approving a login and refusing one are both successful actions.
      detail: (r) => (r.ok ? (r.approved ? 'approved' : 'denied') : null),
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.STEAM_GUARD_SCREENS,
    async (): Promise<ScreenCapture[]> => captureScreens(),
  );

  ipcMain.handle(
    IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS,
    async (
      _e,
      payload?: { accountId?: unknown },
    ): Promise<GuardResult<{ confirmations: GuardConfirmation[] }>> => {
      const result = await listConfirmations(toAccountId(payload));
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason,
          ...(result.message ? { message: result.message } : {}),
        };
      }
      return { ok: true, confirmations: result.data };
    },
  );

  handleAction(
    IPC_CHANNELS.STEAM_GUARD_CONFIRMATIONS_ACT,
    async (_e, payload?: ConfirmActPayload): Promise<GuardResult<{ acted: number }>> => {
      const result = await actOnConfirmations(
        toAccountId(payload),
        toAction(payload),
        toItems(payload),
      );
      if (!result.ok) {
        return {
          ok: false,
          reason: result.reason,
          ...(result.message ? { message: result.message } : {}),
        };
      }
      return { ok: true, acted: result.data.acted };
    },
    {
      action: 'guard.confirm',
      itemId: (p?: ConfirmActPayload) => Number(p?.accountId) || null,
      target: (p?: ConfirmActPayload) => toAction(p),
      detail: (r) => (r.ok ? `${r.acted} items` : null),
    },
  );
};

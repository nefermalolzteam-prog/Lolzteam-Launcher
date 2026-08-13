import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '@shared-ipc';
import type {
  LocalAccountEdit,
  LocalAccountRecord,
  LocalAccountResult,
  LocalDbEntry,
  LocalDbMoveMode,
  LocalDbSetDirResult,
  LocalDbSwitchResult,
  LocalImportCommitRequest,
  LocalImportCommitResult,
  LocalImportPreviewResult,
  LocalImportRequest,
  LocalImportRow,
  LocalLabel,
  LocalLabelResult,
  LocalServiceId,
  RevealFolderResult,
} from '@shared-types';
import { isLocalServiceId } from '@shared-types';
import type { OpenDialogOptions } from 'electron';
import { BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import log from 'electron-log/main';
import { dbKey, marketSidecarDir, pathExists } from '../accounts/db-paths';
import { deleteLocalLabel, listLocalLabels, saveLocalLabel } from '../accounts/label-store';
import { type ImportPlan, MAX_FILES, buildImportPlan } from '../accounts/local-import';
import {
  createLocalAccount,
  deleteLocalAccount,
  forgetLocalDbBase,
  getLocalAccount,
  getLocalStoreDir,
  listLocalAccounts,
  listLocalDbBases,
  listLocalGroups,
  localAccountFolder,
  moveLocalAccountToGroup,
  moveLocalStoreTo,
  setLocalAccountLabels,
  switchLocalStoreTo,
  updateLocalAccount,
} from '../accounts/local-store';
import { validateLocalAccount } from '../accounts/local-validate';
import { type MarketCopyResult, copyToBase } from '../accounts/market-copy';
import { deleteSteamCheck } from '../accounts/steam-check-store';
import { deleteTelegramProfile } from '../accounts/telegram-profile-store';
import { deleteGuardRecord } from '../services/steam-guard/session-store';
import {
  consumeTelegramSession,
  peekTelegramSession,
  readTelegramSessions,
} from '../services/telegram/import';
import { handleAction } from './handle-action';

/** Local ids are negative; anything else belongs to the market channels. */
const toLocalId = (payload?: { id?: unknown }): number => {
  const id = Number(payload?.id);
  if (!Number.isInteger(id) || id >= 0) throw new Error('invalid local account id');
  return id;
};

/** The three payloads a journalled handler reads twice. */
type UpdatePayload = { id?: unknown; input?: unknown };
type MovePayload = { id?: unknown; group?: unknown };
type FromMarketPayload = { itemId?: unknown; mafile?: unknown };

const toEdit = (record: LocalAccountRecord): LocalAccountEdit =>
  record.service === 'steam'
    ? {
        id: record.id,
        service: 'steam',
        label: record.label,
        login: record.login,
        hasSharedSecret: record.sharedSecret !== null,
        hasIdentitySecret: record.identitySecret !== null,
      }
    : {
        id: record.id,
        service: 'telegram',
        label: record.label,
        dcId: record.dcId,
        phone: record.phone,
        userId: record.userId,
        hasAuthKey: true,
      };

/** Drops the browser storage a `web` login left behind for this account. */
const clearAccountPartition = async (id: number): Promise<void> => {
  try {
    await session.fromPartition(`persist:lzt-account-${id}`).clearStorageData();
  } catch (err) {
    log.warn(`[local-accounts] failed to clear the partition of #${id}`, err);
  }
};

/** Prepared import plans, waiting for the user to approve the report. */
const PLAN_TTL_MS = 10 * 60 * 1000;
const plans = new Map<string, { plan: ImportPlan; at: number }>();

const sweepPlans = (): void => {
  const cutoff = Date.now() - PLAN_TTL_MS;
  for (const [token, entry] of plans) {
    if (entry.at < cutoff) plans.delete(token);
  }
};

/** The payload crosses IPC as `unknown`; only the shape the plan needs survives. */
const toImportRequest = (payload: unknown): LocalImportRequest | null => {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (!isLocalServiceId(raw.service)) return null;

  const files: { name: string; text: string }[] = [];
  if (Array.isArray(raw.files)) {
    for (const entry of raw.files.slice(0, MAX_FILES)) {
      if (!entry || typeof entry !== 'object') continue;
      const { name, text } = entry as Record<string, unknown>;
      if (typeof name !== 'string' || typeof text !== 'string') continue;
      files.push({ name, text });
    }
  }

  const dc = Number(raw.defaultDcId);
  return {
    service: raw.service,
    files,
    text: typeof raw.text === 'string' ? raw.text : '',
    ...(Number.isInteger(dc) && dc > 0 ? { defaultDcId: dc } : {}),
    ...(typeof raw.dir === 'string' && raw.dir ? { dir: raw.dir } : {}),
  };
};

/** Swaps a `telegram:identify` ticket for the key it stands for. */
type Redeemed = { ok: true; input: unknown; token: string | null } | { ok: false; message: string };

const redeemSessionToken = (input: unknown): Redeemed => {
  if (!input || typeof input !== 'object') return { ok: true, input, token: null };
  const raw = input as Record<string, unknown>;
  const token = raw.sessionToken;
  if (raw.service !== 'telegram' || typeof token !== 'string' || !token) {
    return { ok: true, input, token: null };
  }

  const creds = peekTelegramSession(token);
  if (!creds) return { ok: false, message: 'session_expired' };

  const typed = (key: string): string => {
    const value = raw[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  return {
    ok: true,
    token,
    input: {
      ...raw,
      // Bare hex, never `hex:<dc>`: a data centre the user overrode by hand must not collide with the one the container carried.
      authKey: creds.authKeyHex,
      dcId: typed('dcId') || String(creds.dcId),
      phone: typed('phone') || creds.phone || '',
      userId: typed('userId') || (creds.userId === null ? '' : String(creds.userId)),
    },
  };
};

/** Where an account's files are, whichever kind of account it is. */
const accountFolder = async (
  id: number,
  service: LocalServiceId | null,
): Promise<string | null> => {
  if (id < 0) return localAccountFolder(id);
  if (!service) return null;
  const dir = await marketSidecarDir(service, id);
  // Not created on demand: an empty folder would be a worse answer than saying there is nothing stored for this account yet.
  return (await pathExists(dir)) ? dir : null;
};

export const registerLocalAccountsIpc = (): void => {
  /** Which service a form was for, and nothing else from it. */
  const serviceOf = (payload?: { input?: unknown }): string | null => {
    const input = payload?.input;
    if (!input || typeof input !== 'object') return null;
    const service = (input as { service?: unknown }).service;
    return isLocalServiceId(service) ? service : null;
  };

  handleAction(
    IPC_CHANNELS.LOCAL_ACCOUNT_CREATE,
    async (_e, payload?: { input?: unknown }): Promise<LocalAccountResult> => {
      const redeemed = redeemSessionToken(payload?.input);
      if (!redeemed.ok) return redeemed;
      const validated = validateLocalAccount(redeemed.input);
      if (!validated.ok) return validated;
      const result = await createLocalAccount(validated.value);
      if (result.ok && redeemed.token) consumeTelegramSession(redeemed.token);
      return result;
    },
    { action: 'local.create', target: serviceOf },
  );

  /** The copy, and the one question it may ask the market at a price. */
  handleAction(
    IPC_CHANNELS.LOCAL_ACCOUNT_FROM_MARKET,
    async (_e, payload?: FromMarketPayload): Promise<MarketCopyResult> =>
      copyToBase(Number(payload?.itemId), {
        mafile: payload?.mafile === 'fetch' ? 'fetch' : 'skip',
      }),
    {
      action: 'local.fromMarket',
      itemId: (p?: FromMarketPayload) => Number(p?.itemId) || null,
      detail: (r) => (r.ok ? r.detail : null),
    },
  );

  handleAction(
    IPC_CHANNELS.LOCAL_ACCOUNT_UPDATE,
    async (_e, payload?: UpdatePayload): Promise<LocalAccountResult> => {
      const id = toLocalId(payload);
      const previous = await getLocalAccount(id);
      if (!previous) return { ok: false, message: 'not_found' };
      const redeemed = redeemSessionToken(payload?.input);
      if (!redeemed.ok) return redeemed;
      const validated = validateLocalAccount(redeemed.input, previous);
      if (!validated.ok) return validated;
      const result = await updateLocalAccount(id, validated.value);
      if (result.ok && redeemed.token) consumeTelegramSession(redeemed.token);
      return result;
    },
    {
      // Both callbacks spell the whole payload out, and have to: the spec is what decides the payload type (see `handleAction`).
      action: 'local.update',
      target: (p?: UpdatePayload) => serviceOf(p),
      itemId: (p?: UpdatePayload) => Number(p?.id) || null,
    },
  );

  handleAction(
    IPC_CHANNELS.LOCAL_ACCOUNT_DELETE,
    async (_e, payload?: { id?: unknown }): Promise<LocalAccountResult> => {
      const id = toLocalId(payload);
      const result = await deleteLocalAccount(id);
      // Only after the record is gone — a failed delete must leave the account exactly as it was, cookies included.
      if (result.ok) {
        await clearAccountPartition(id);
        await deleteGuardRecord(id);
        await deleteTelegramProfile(id);
        await deleteSteamCheck(id);
      }
      return result;
    },
    { action: 'local.delete', itemId: (p?: { id?: unknown }) => Number(p?.id) || null },
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_ACCOUNT_FORM,
    async (_e, payload?: { id?: unknown }): Promise<LocalAccountEdit | null> => {
      const record = await getLocalAccount(toLocalId(payload));
      return record ? toEdit(record) : null;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_PREVIEW,
    async (_e, payload?: unknown): Promise<LocalImportPreviewResult> => {
      const request = toImportRequest(payload);
      if (!request) return { ok: false, message: 'invalid_input' };

      sweepPlans();
      // A folder is read here, in main: a tdata is a directory of binaries.
      const sessions =
        request.service === 'telegram' && request.dir
          ? await readTelegramSessions(request.dir).catch((err) => {
              log.warn(`[local-accounts] import: ${request.dir} unreadable`, err);
              return [];
            })
          : [];
      const plan = buildImportPlan(request, await listLocalAccounts(), sessions);
      const token = randomUUID();
      plans.set(token, { plan, at: Date.now() });
      return { ok: true, preview: { token, service: plan.service, groups: plan.groups } };
    },
  );

  handleAction(
    IPC_CHANNELS.LOCAL_ACCOUNT_IMPORT_COMMIT,
    async (_e, payload?: Partial<LocalImportCommitRequest>): Promise<LocalImportCommitResult> => {
      const token = typeof payload?.token === 'string' ? payload.token : '';
      const entry = plans.get(token);
      // One shot per preview: a second commit would create everything twice.
      plans.delete(token);
      if (!entry) return { ok: false, message: 'expired' };

      const { plan } = entry;
      const queued = payload?.includeMissingGuard
        ? [...plan.matched, ...plan.missingGuard]
        : plan.matched;

      let created = 0;
      const failed: LocalImportRow[] = [];
      for (const record of queued) {
        const result = await createLocalAccount(record.value);
        if (result.ok) created++;
        else failed.push({ ...record.row, reason: result.message });
      }
      if (failed.length > 0) {
        log.warn(`[local-accounts] import: ${failed.length} record(s) rejected by the store`);
      }
      return { ok: true, created, failed };
    },
    {
      action: 'local.import',
      detail: (r) => (r.ok ? `${r.created} created, ${r.failed.length} failed` : null),
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_ACCOUNT_REVEAL,
    async (_e, payload?: { id?: unknown; service?: unknown }): Promise<RevealFolderResult> => {
      const id = Number(payload?.id);
      if (!Number.isInteger(id) || id === 0) return { ok: false, message: 'not_found' };
      const service = isLocalServiceId(payload?.service) ? payload.service : null;

      const dir = await accountFolder(id, service);
      if (!dir) return { ok: false, message: 'not_found' };

      // `openPath` shows the folder's contents; `showItemInFolder` would open the parent with this one highlighted.
      const error = await shell.openPath(dir);
      if (error) {
        log.warn(`[local-accounts] could not open ${dir}: ${error}`);
        return { ok: false, message: 'failed' };
      }
      return { ok: true, dir };
    },
  );

  handleAction(
    IPC_CHANNELS.LOCAL_ACCOUNT_MOVE,
    async (_e, payload?: MovePayload): Promise<LocalAccountResult> => {
      const id = toLocalId(payload);
      const group = typeof payload?.group === 'string' ? payload.group : '';
      // `normaliseGroup` in the store has the last word on what a folder name may be — this is a bridge.
      return moveLocalAccountToGroup(id, group);
    },
    {
      action: 'local.move',
      itemId: (p?: MovePayload) => Number(p?.id) || null,
      target: (p?: MovePayload) => (typeof p?.group === 'string' ? p.group : null),
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_ACCOUNT_GROUPS,
    async (): Promise<Record<LocalServiceId, string[]>> => listLocalGroups(),
  );

  handleAction(
    IPC_CHANNELS.LOCAL_ACCOUNT_LABELS,
    async (_e, payload?: { id?: unknown; labels?: unknown }): Promise<LocalAccountResult> => {
      const id = toLocalId(payload);
      const raw = Array.isArray(payload?.labels) ? payload.labels : [];
      const labels = raw.filter((v): v is number => Number.isInteger(v) && (v as number) < 0);
      return setLocalAccountLabels(id, labels);
    },
    { action: 'local.labels', itemId: (p?: { id?: unknown }) => Number(p?.id) || null },
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_LABEL_LIST,
    async (): Promise<LocalLabel[]> => listLocalLabels(),
  );

  handleAction(
    IPC_CHANNELS.LOCAL_LABEL_SAVE,
    async (
      _e,
      payload?: { id?: unknown; title?: unknown; bc?: unknown },
    ): Promise<LocalLabelResult> => {
      const raw = Number(payload?.id);
      // Only an existing (negative) id edits; anything else is a new label.
      const id = Number.isInteger(raw) && raw < 0 ? raw : null;
      return saveLocalLabel({
        id,
        title: typeof payload?.title === 'string' ? payload.title : '',
        bc: typeof payload?.bc === 'string' ? payload.bc : '',
      });
    },
    {
      action: 'local.label.save',
      target: (p?: { title?: unknown }) => (typeof p?.title === 'string' ? p.title : null),
    },
  );

  handleAction(
    IPC_CHANNELS.LOCAL_LABEL_DELETE,
    async (_e, payload?: { id?: unknown }): Promise<LocalLabelResult> => {
      const raw = Number(payload?.id);
      if (!Number.isInteger(raw) || raw >= 0) return { ok: false, message: 'not_found' };
      return deleteLocalLabel(raw);
    },
    { action: 'local.label.delete' },
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_DB_PICK_DIR, async (event): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      defaultPath: await getLocalStoreDir(),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  handleAction(
    IPC_CHANNELS.LOCAL_DB_SET_DIR,
    async (_e, payload?: { dir?: unknown; mode?: unknown }): Promise<LocalDbSetDirResult> => {
      const dir = typeof payload?.dir === 'string' && payload.dir ? payload.dir : null;
      const mode = payload?.mode as LocalDbMoveMode;
      if (mode !== 'move' && mode !== 'adopt' && mode !== 'replace') {
        return { ok: false, reason: 'move_failed' };
      }
      return moveLocalStoreTo(dir, mode);
    },
    // The mode, not the path: where a user keeps his base is his business.
    {
      action: 'localDb.setDir',
      target: (p?: { mode?: unknown }) => (typeof p?.mode === 'string' ? p.mode : null),
    },
  );

  ipcMain.handle(IPC_CHANNELS.LOCAL_DB_LIST, (): Promise<LocalDbEntry[]> => listLocalDbBases());

  handleAction(
    IPC_CHANNELS.LOCAL_DB_SWITCH,
    async (_e, payload?: { dir?: unknown }): Promise<LocalDbSwitchResult> => {
      const dir = typeof payload?.dir === 'string' && payload.dir ? payload.dir : null;
      return switchLocalStoreTo(dir);
    },
    { action: 'localDb.switch' },
  );

  handleAction(
    IPC_CHANNELS.LOCAL_DB_FORGET,
    async (_e, payload?: { dir?: unknown }): Promise<LocalDbEntry[]> => {
      // The app's own folder has no path to forget.
      const dir = typeof payload?.dir === 'string' && payload.dir ? payload.dir : null;
      return dir ? forgetLocalDbBase(dir) : listLocalDbBases();
    },
    { action: 'localDb.forget' },
  );

  ipcMain.handle(
    IPC_CHANNELS.LOCAL_DB_REVEAL,
    async (_e, payload?: { dir?: unknown }): Promise<RevealFolderResult> => {
      const asked = typeof payload?.dir === 'string' && payload.dir ? payload.dir : null;
      // Only a folder the app already knows as a base is opened.
      const bases = await listLocalDbBases();
      const base =
        asked === null
          ? bases.find((b) => b.dir === null)
          : bases.find((b) => b.dir !== null && dbKey(b.dir) === dbKey(asked));
      if (!base || !base.available) return { ok: false, message: 'not_found' };

      const error = await shell.openPath(base.path);
      if (error) {
        log.warn(`[local-accounts] could not open ${base.path}: ${error}`);
        return { ok: false, message: 'failed' };
      }
      return { ok: true, dir: base.path };
    },
  );
};

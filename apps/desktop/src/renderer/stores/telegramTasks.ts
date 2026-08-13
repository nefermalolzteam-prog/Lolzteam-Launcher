import type {
  SteamCheckRequest,
  SteamFriendsRequest,
  SteamLinkRequest,
  TelegramCheckRequest,
  TelegramCleanupRequest,
  TelegramPrivacyRequest,
  TelegramProfileRequest,
  TelegramRunStart,
  TelegramRunSummary,
  TelegramTaskEvent,
  TelegramTaskKind,
  TelegramTaskRow,
} from '@shared-types';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useSteamChecks } from './steamChecks';
import { forgetTelegramAvatars, useTelegramProfiles } from './telegramProfiles';

interface TelegramTasksState {
  runId: string | null;
  kind: TelegramTaskKind | null;
  running: boolean;
  rows: ReadonlyMap<number, TelegramTaskRow>;
  /** When each row last arrived, epoch ms — «час назад» under the verdict the list is showing. */
  rowAt: ReadonlyMap<number, number>;
  summary: TelegramRunSummary | null;
  begin: (runId: string, kind: TelegramTaskKind) => void;
  apply: (event: TelegramTaskEvent) => void;
  clear: () => void;
}

export const useTelegramTasks = create<TelegramTasksState>((set) => ({
  runId: null,
  kind: null,
  running: false,
  rows: new Map(),
  rowAt: new Map(),
  summary: null,
  begin: (runId, kind) =>
    set((state) =>
      // Main starts emitting the moment it accepts the run.
      state.runId === runId
        ? { kind, running: state.summary === null }
        : { runId, kind, running: true, rows: new Map(), rowAt: new Map(), summary: null },
    ),
  apply: (event) =>
    set((state) => {
      // An event from a run we did not start (a second window, a stale reply) must not overwrite the rows this one is showing.
      if (state.runId !== null && event.runId !== state.runId) return state;
      const next: Partial<TelegramTasksState> =
        state.runId === null ? { runId: event.runId, kind: event.kind, running: true } : {};
      if (event.row) {
        const rows = new Map(state.rows);
        rows.set(event.row.accountId, event.row);
        next.rows = rows;
        const rowAt = new Map(state.rowAt);
        rowAt.set(event.row.accountId, Date.now());
        next.rowAt = rowAt;
      }
      if (event.summary) {
        next.summary = event.summary;
        next.running = false;
      }
      return next;
    }),
  clear: () =>
    set({
      runId: null,
      kind: null,
      running: false,
      rows: new Map(),
      rowAt: new Map(),
      summary: null,
    }),
}));

/** Subscribes the store to main, and keeps the persisted verdicts in step. */
export const useTelegramTaskStream = (): void => {
  const apply = useTelegramTasks((s) => s.apply);
  useEffect(
    () =>
      window.launcher.tasks.onProgress((event) => {
        apply(event);
        if (event.row) {
          useTelegramProfiles.getState().applyRow(event.row);
          useSteamChecks.getState().applyRow(event.row);
        }
        if (event.summary) {
          forgetTelegramAvatars();
          void useTelegramProfiles.getState().load();
          void useSteamChecks.getState().load();
        }
      }),
    [apply],
  );
  useEffect(() => {
    void useTelegramProfiles.getState().load();
    void useSteamChecks.getState().load();
  }, []);
};

export const startTelegramCheck = async (req: TelegramCheckRequest): Promise<TelegramRunStart> => {
  // Cleared before the call, not after it: the first rows can arrive while the reply is still in flight.
  useTelegramTasks.getState().clear();
  const res = await window.launcher.telegram.check(req);
  if (res.ok) useTelegramTasks.getState().begin(res.runId, 'check');
  return res;
};

export const startTelegramProfileFill = async (
  req: TelegramProfileRequest,
): Promise<TelegramRunStart> => {
  useTelegramTasks.getState().clear();
  const res = await window.launcher.telegram.fillProfiles(req);
  if (res.ok) useTelegramTasks.getState().begin(res.runId, 'profile');
  return res;
};

export const startTelegramCleanup = async (
  req: TelegramCleanupRequest,
): Promise<TelegramRunStart> => {
  useTelegramTasks.getState().clear();
  const res = await window.launcher.telegram.cleanup(req);
  if (res.ok) useTelegramTasks.getState().begin(res.runId, 'cleanup');
  return res;
};

export const startTelegramPrivacy = async (
  req: TelegramPrivacyRequest,
): Promise<TelegramRunStart> => {
  useTelegramTasks.getState().clear();
  const res = await window.launcher.telegram.privacy(req);
  if (res.ok) useTelegramTasks.getState().begin(res.runId, 'privacy');
  return res;
};

/** A Steam run, started into the very same store. */
export const startSteamCheck = async (req: SteamCheckRequest): Promise<TelegramRunStart> => {
  useTelegramTasks.getState().clear();
  const res = await window.launcher.steam.check(req);
  if (res.ok) useTelegramTasks.getState().begin(res.runId, 'steam-check');
  return res;
};

export const startSteamFriendsPurge = async (
  req: SteamFriendsRequest,
): Promise<TelegramRunStart> => {
  useTelegramTasks.getState().clear();
  const res = await window.launcher.steam.friends(req);
  if (res.ok) useTelegramTasks.getState().begin(res.runId, 'steam-friends');
  return res;
};

export const startSteamLink = async (req: SteamLinkRequest): Promise<TelegramRunStart> => {
  useTelegramTasks.getState().clear();
  const res = await window.launcher.steam.link(req);
  if (res.ok) useTelegramTasks.getState().begin(res.runId, 'steam-link');
  return res;
};

export const cancelTelegramRun = (): void => {
  const { runId } = useTelegramTasks.getState();
  if (runId) void window.launcher.tasks.cancel(runId);
};

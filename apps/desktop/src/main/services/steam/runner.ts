import { IPC_CHANNELS } from '@shared-ipc';
import type {
  LauncherSettings,
  ProxyEntry,
  SteamCheckRequest,
  SteamFriendTarget,
  SteamFriendsRequest,
  SteamLinkRequest,
  TelegramRunStart,
  TelegramTaskEvent,
  TelegramTaskKind,
  TelegramTaskRow,
} from '@shared-types';
import { pinnedProxyFor } from '@shared-types';
import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { saveSteamCheck } from '../../accounts/steam-check-store';
import { getSettings } from '../../settings/settings-store';
import { claimRun, releaseRun } from '../run/active';
import { describeFailure, isNetworkFailure } from '../run/failure';
import { recordRun } from '../run/journal';
import { type RunSlot, clampConcurrency, runQueue } from '../run/queue';
import { linkGuardAccount } from '../steam-guard/session';
import { getGuardRecord } from '../steam-guard/session-store';
import { checkSteamAccount } from './checker';
import { purgeSteamFriends } from './friends';

const blankRow = (accountId: number): TelegramTaskRow => ({
  accountId,
  state: 'queued',
  step: null,
  check: null,
  steam: null,
  filled: null,
  cleaned: null,
  privacy: null,
  friends: null,
  link: null,
  error: null,
  detail: null,
  waitSeconds: null,
});

/** Guarded for the same reason the Telegram one is: see `telegram/runner.ts`. */
const broadcast = (event: TelegramTaskEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.TASK_PROGRESS, event);
    } catch (err) {
      log.warn('[steam/run] progress send failed', err);
    }
  }
};

/** The routes a Steam run may take, gated the same way a Steam login is: the global switch. */
const steamProxies = (settings: LauncherSettings, proxyIds: readonly string[]): ProxyEntry[] => {
  if (!settings.proxyEnabled) return [];
  if (!settings.proxyServices.includes('steam')) return [];
  const chosen = new Set(proxyIds);
  return settings.proxies.filter((p) => chosen.has(p.id));
};

/** One account's turn, whatever the operation is. */
type SteamJob = (
  accountId: number,
  proxy: ProxyEntry | null,
  signal: AbortSignal,
  emit: (row: TelegramTaskRow) => void,
) => Promise<TelegramTaskRow>;

interface SteamRunPlan {
  readonly kind: TelegramTaskKind;
  readonly accountIds: readonly number[];
  readonly proxyIds: readonly string[];
  readonly job: SteamJob;
  /** Which failed rows count towards the streak that ends the run. */
  readonly systemic: (row: TelegramTaskRow) => boolean;
}

/** Claims the run slot and hands the list to the queue. */
const start = (plan: SteamRunPlan): TelegramRunStart => {
  if (plan.accountIds.length === 0) return { ok: false, reason: 'empty' };

  const claim = claimRun();
  if (!claim.ok) return { ok: false, reason: 'busy' };

  void execute(claim.runId, claim.signal, plan)
    .catch((err) => {
      log.error(`[steam/run] ${claim.runId} died`, err);
      broadcast({
        runId: claim.runId,
        kind: plan.kind,
        row: null,
        summary: {
          total: plan.accountIds.length,
          ok: 0,
          failed: 0,
          skipped: plan.accountIds.length,
          stopped: 'internal_error',
        },
      });
    })
    .finally(() => {
      releaseRun(claim.runId);
    });

  return { ok: true, runId: claim.runId };
};

const execute = async (runId: string, signal: AbortSignal, plan: SteamRunPlan): Promise<void> => {
  const startedAt = Date.now();
  const settings = await getSettings();

  const emit = (row: TelegramTaskRow | null, summary: TelegramTaskEvent['summary'] = null): void =>
    broadcast({ runId, kind: plan.kind, row, summary });

  for (const accountId of plan.accountIds) emit(blankRow(accountId));

  const outcome = await runQueue<number, TelegramTaskRow>({
    runId,
    signal,
    items: plan.accountIds,
    // The same setting the Telegram runs use.
    concurrency: clampConcurrency(settings.telegramTaskConcurrency, plan.accountIds.length),
    proxies: steamProxies(settings, plan.proxyIds),
    // A pinned account ignores the pool it was handed and goes out through its own address.
    pinned: (accountId) => pinnedProxyFor(settings, accountId, 'steam'),
    run: (slot: RunSlot<number>) => plan.job(slot.item, slot.proxy, signal, emit),
    skipped: (accountId) => ({ ...blankRow(accountId), state: 'skipped' }),
    // Our own bug, reported as a failure rather than as "never reached": this account's turn happened.
    crashed: (accountId, err) => ({
      ...blankRow(accountId),
      state: 'failed',
      error: 'unknown',
      detail: err instanceof Error ? err.message : String(err),
    }),
    failed: (row) => row.state === 'failed',
    systemic: plan.systemic,
    emit: (row) => emit(row),
  });

  emit(null, {
    total: outcome.total,
    ok: outcome.ok,
    failed: outcome.failed,
    skipped: outcome.skipped,
    stopped: outcome.stopped,
  });
  recordRun(plan.kind, outcome, Date.now() - startedAt);
  log.info(
    `[steam/run] ${plan.kind} ${runId}: ${outcome.ok} ok, ${outcome.failed} failed${
      outcome.stopped ? `, stopped: ${outcome.stopped}` : ''
    }`,
  );
};

/* ------------------------------------------------------------------ *
 * The validity check.
 * ------------------------------------------------------------------ */

/** Starts a validity run over the selected accounts. */
export const startSteamCheckRun = (req: SteamCheckRequest): TelegramRunStart =>
  start({
    kind: 'steam-check',
    accountIds: [...new Set(req.accountIds)].filter((id) => id < 0),
    proxyIds: req.proxyIds,
    job: (accountId, proxy, _signal, emit) => checkOne(accountId, proxy, emit),
    // A dead session is an answer and comes back `done`, so it never reaches here.
    systemic: (row) => row.error === 'network',
  });

/** One account, start to finish. */
const checkOne = async (
  accountId: number,
  proxy: ProxyEntry | null,
  emit: (row: TelegramTaskRow) => void,
): Promise<TelegramTaskRow> => {
  const base = { ...blankRow(accountId), state: 'running' as const };
  emit({ ...base, step: 'resolving' });

  try {
    emit({ ...base, step: 'connecting' });
    const result = await checkSteamAccount(accountId, proxy);
    if (!result.ok) {
      // `unreachable` is the network, not the account, and it carries `network` so the queue's streak can see it.
      if (result.reason === 'unreachable') {
        log.warn(`[steam/run] account ${accountId} unreachable: ${result.detail ?? '—'}`);
        return { ...base, state: 'failed', error: 'network', detail: result.detail };
      }
      log.warn(`[steam/run] account ${accountId} refused: ${result.reason}`);
      return { ...base, state: 'failed', error: 'unknown', detail: result.reason };
    }
    // Written down before the row goes out, so the answer survives the window the row is drawn in.
    await saveSteamCheck(accountId, result.info).catch((err) => {
      log.warn(`[steam/run] account ${accountId}: check not stored`, err);
    });
    return { ...base, state: 'done', step: null, steam: result.info };
  } catch (err) {
    // The check promises not to throw; if it does.
    const { error, detail } = describeFailure(err);
    log.warn(`[steam/run] account ${accountId} failed: ${detail}`);
    return { ...base, state: 'failed', error, detail };
  }
};

/* ------------------------------------------------------------------ *
 * Emptying the friends list.
 * ------------------------------------------------------------------ */

/** Starts a friends purge over the selected accounts. */
export const startSteamFriendsRun = (req: SteamFriendsRequest): TelegramRunStart => {
  const targets = [...new Set(req.targets)];
  // A run with nothing selected would walk every account's list and write nothing, which reads as a bug from the outside.
  if (targets.length === 0) return { ok: false, reason: 'empty' };
  return start({
    kind: 'steam-friends',
    accountIds: [...new Set(req.accountIds)],
    proxyIds: req.proxyIds,
    job: (accountId, proxy, signal, emit) =>
      purgeOne(accountId, { targets, block: req.block }, proxy, signal, emit),
    // A rate limit is Steam talking about the run, not about account #12, and an unreachable list is the network.
    systemic: (row) => row.error === 'network' || row.error === 'flood_wait',
  });
};

const purgeOne = async (
  accountId: number,
  options: { readonly targets: readonly SteamFriendTarget[]; readonly block: boolean },
  proxy: ProxyEntry | null,
  signal: AbortSignal,
  emit: (row: TelegramTaskRow) => void,
): Promise<TelegramTaskRow> => {
  const base = { ...blankRow(accountId), state: 'running' as const };
  emit({ ...base, step: 'resolving' });

  try {
    const outcome = await purgeSteamFriends(accountId, options, {
      ...(proxy ? { proxy } : {}),
      signal,
      report: (step) => emit({ ...base, step }),
    });

    if (!outcome.failure) {
      return { ...base, state: 'done', step: null, friends: outcome.result };
    }

    // Carried on a failed row too, but only once the list was actually read.
    const partial = outcome.result.scanned > 0 ? outcome.result : null;
    const failure = outcome.failure;
    const row = { ...base, state: 'failed' as const, step: null, friends: partial };
    switch (failure.reason) {
      case 'not_linked':
        return { ...row, error: 'not_linked' };
      case 'refused':
        return { ...row, error: 'session_refused', detail: failure.detail };
      case 'rate_limited':
        return { ...row, error: 'flood_wait' };
      case 'cancelled':
        return { ...row, error: 'cancelled' };
      default:
        return { ...row, error: 'network', detail: failure.detail };
    }
  } catch (err) {
    // The engine promises not to throw; if it does.
    const { error, detail } = describeFailure(err);
    log.warn(`[steam/friends] account ${accountId} crashed: ${detail}`);
    return { ...base, state: 'failed', step: null, error, detail };
  }
};

/** Starts a Steam Guard link over the selected accounts. */
export const startSteamLinkRun = (req: SteamLinkRequest): TelegramRunStart =>
  start({
    kind: 'steam-link',
    accountIds: [...new Set(req.accountIds)].filter((id) => id < 0),
    proxyIds: req.proxyIds,
    job: (accountId, proxy, _signal, emit) => linkOne(accountId, proxy, emit),
    // Only the network.
    systemic: (row) => row.error === 'network',
  });

/** One account's link. */
const linkOne = async (
  accountId: number,
  proxy: ProxyEntry | null,
  emit: (row: TelegramTaskRow) => void,
): Promise<TelegramTaskRow> => {
  const base = { ...blankRow(accountId), state: 'running' as const };
  emit({ ...base, step: 'resolving' });

  try {
    const existing = await getGuardRecord(accountId);
    if (existing) {
      return {
        ...base,
        state: 'done',
        step: null,
        link: { accountName: existing.accountName, already: true },
      };
    }

    emit({ ...base, step: 'linking' });
    const result = await linkGuardAccount(accountId, { proxyId: proxy?.id ?? null });
    if (result.ok) {
      return {
        ...base,
        state: 'done',
        step: null,
        link: { accountName: result.record.accountName, already: false },
      };
    }

    const row = { ...base, state: 'failed' as const, step: null };
    switch (result.reason) {
      case 'no_account':
        return { ...row, error: 'no_account' };
      case 'no_credentials':
        return { ...row, error: 'no_credentials' };
      case 'needs_email_code':
        return { ...row, error: 'needs_email_code' };
      case 'network':
        return { ...row, error: 'network', detail: result.message ?? null };
      default:
        // A refused sign-in is the only thing left, and it arrives as one word plus whatever steam-session said.
        return isNetworkFailure(new Error(result.message ?? ''))
          ? { ...row, error: 'network', detail: result.message ?? null }
          : { ...row, error: 'session_refused', detail: result.message ?? null };
    }
  } catch (err) {
    const { error, detail } = describeFailure(err);
    log.warn(`[steam/link] account ${accountId} crashed: ${detail}`);
    return { ...base, state: 'failed', step: null, error, detail };
  }
};

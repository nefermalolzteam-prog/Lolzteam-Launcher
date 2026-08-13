import type { TelegramClient } from '@mtcute/core/client.js';
import { IPC_CHANNELS } from '@shared-ipc';
import type {
  ProxyEntry,
  TelegramCheckInfo,
  TelegramCleanupResult,
  TelegramPrivacyResult,
  TelegramProfileFill,
  TelegramRunStart,
  TelegramTaskError,
  TelegramTaskEvent,
  TelegramTaskKind,
  TelegramTaskRow,
  TelegramTaskStep,
} from '@shared-types';
import { pinnedProxyFor } from '@shared-types';
import { BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { sleep } from '../../lib/sleep';
import { getSettings } from '../../settings/settings-store';
import { cancelRun, claimRun, isRunActive, releaseRun } from '../run/active';
import { describeFailure } from '../run/failure';
import { recordRun } from '../run/journal';
import { type RunSlot, clampConcurrency, runQueue } from '../run/queue';
import {
  RATE_LIMIT_PAUSE_MS,
  deadCheckInfo,
  floodWaitSeconds,
  frozenCheckInfo,
  isDeadKeyError,
  isFrozenError,
  isRateLimitError,
  isRetryableError,
} from './checker';
import { type ResolvedTelegramAccount, resolveTelegramAccount, telegramProxy } from './resolve';
import { withTelegramClient } from './runtime';

/** A flood wait longer than this is reported rather than waited out. */
const MAX_WAIT_SECONDS = 90;

/** What a job hands back to be shown on the row. */
export interface TelegramTaskPayload {
  readonly check?: TelegramCheckInfo;
  /** What a profile run wrote onto the account. */
  readonly filled?: TelegramProfileFill;
  /** What a cleanup removed. */
  readonly cleaned?: TelegramCleanupResult;
  /** Which privacy rules went through. */
  readonly privacy?: TelegramPrivacyResult;
}

/** One account's turn. */
export type TelegramJob = (
  client: TelegramClient,
  account: ResolvedTelegramAccount,
  report: (step: TelegramTaskStep, waitSeconds?: number | null) => void,
  signal: AbortSignal,
  keepAlive: () => void,
) => Promise<TelegramTaskPayload>;

export interface TelegramRunOptions {
  readonly kind: TelegramTaskKind;
  readonly accountIds: readonly number[];
  /** Empty = straight out; one = all through it; several = round-robin. */
  readonly proxyIds: readonly string[];
  /** Called once per account, with the row that ended its turn. */
  readonly onSettled?: (row: TelegramTaskRow) => void;
}

/** Progress never takes the run down with it. */
const broadcast = (event: TelegramTaskEvent): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.TASK_PROGRESS, event);
    } catch (err) {
      log.warn('[telegram/run] progress send failed', err);
    }
  }
};

const blankRow = (accountId: number): TelegramTaskRow => ({
  accountId,
  state: 'queued',
  step: null,
  check: null,
  // Never anything else from here: these three belong to the Steam runs.
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

/** Whether a failure says something about the whole run or only about one account. */
const isSystemic = (error: TelegramTaskError): boolean =>
  error === 'network' || error === 'flood_wait' || error === 'unknown';

/** The one-word verdict for a failure nothing above could read. */
const errorOf = (err: unknown): { error: TelegramTaskError; detail: string } =>
  describeFailure(err);

/** Runs one job over a list of accounts and reports every move. */
export const startTelegramRun = (
  options: TelegramRunOptions,
  job: TelegramJob,
): TelegramRunStart => {
  const accountIds = [...new Set(options.accountIds)];
  if (accountIds.length === 0) return { ok: false, reason: 'empty' };

  const claim = claimRun();
  if (!claim.ok) return { ok: false, reason: 'busy' };

  void execute(claim.runId, claim.signal, accountIds, options, job)
    .catch((err) => {
      // Nothing above is supposed to throw, so reaching here means a bug.
      log.error(`[telegram/run] ${claim.runId} died`, err);
      broadcast({
        runId: claim.runId,
        kind: options.kind,
        row: null,
        summary: {
          total: accountIds.length,
          ok: 0,
          failed: 0,
          skipped: accountIds.length,
          stopped: 'internal_error',
        },
      });
    })
    .finally(() => {
      releaseRun(claim.runId);
    });

  return { ok: true, runId: claim.runId };
};

export const cancelTelegramRun = (runId: string): void => cancelRun(runId);

export const isTelegramRunActive = (): boolean => isRunActive();

const execute = async (
  runId: string,
  signal: AbortSignal,
  accountIds: readonly number[],
  options: TelegramRunOptions,
  job: TelegramJob,
): Promise<void> => {
  const startedAt = Date.now();
  const settings = await getSettings();

  const emit = (row: TelegramTaskRow | null, summary: TelegramTaskEvent['summary'] = null): void =>
    broadcast({ runId, kind: options.kind, row, summary });

  for (const accountId of accountIds) emit(blankRow(accountId));

  // The proxies are resolved once: `telegramProxy` reads the settings.
  const proxies: ProxyEntry[] = [];
  for (const id of options.proxyIds) {
    const proxy = await telegramProxy(id);
    if (proxy) proxies.push(proxy);
  }

  const outcome = await runQueue<number, TelegramTaskRow>({
    runId,
    signal,
    items: accountIds,
    concurrency: clampConcurrency(settings.telegramTaskConcurrency, accountIds.length),
    proxies,
    // The account's own address, when it has one, ahead of the spread — see `accountProxies` in the settings type.
    pinned: (accountId) => pinnedProxyFor(settings, accountId, 'telegram'),
    run: async (slot: RunSlot<number>) => {
      const row = await runOne(slot.item, slot.proxy, job, emit, signal);
      persist(row, options);
      return row;
    },
    skipped: (accountId) => ({ ...blankRow(accountId), state: 'skipped' }),
    // `runOne` is not supposed to throw, so this is the row for our own bug — and it is `failed`, not `skipped`.
    crashed: (accountId, err) => {
      const row: TelegramTaskRow = {
        ...blankRow(accountId),
        state: 'failed',
        ...errorOf(err),
      };
      persist(row, options);
      return row;
    },
    failed: (row) => row.state === 'failed',
    systemic: (row) => row.error !== null && isSystemic(row.error),
    emit: (row) => emit(row),
  });

  emit(null, {
    total: outcome.total,
    ok: outcome.ok,
    failed: outcome.failed,
    skipped: outcome.skipped,
    stopped: outcome.stopped,
  });
  recordRun(options.kind, outcome, Date.now() - startedAt);
  log.info(
    `[telegram/run] ${options.kind} ${runId}: ${outcome.ok} ok, ${outcome.failed} failed${
      outcome.stopped ? `, stopped: ${outcome.stopped}` : ''
    }`,
  );
};

/** Bookkeeping must never take the run down with it. */
const persist = (row: TelegramTaskRow, options: TelegramRunOptions): void => {
  try {
    options.onSettled?.(row);
  } catch (err) {
    log.warn(`[telegram/run] onSettled failed for ${row.accountId}`, err);
  }
};

/** One account, start to finish, including the retries its error earns it. */
const runOne = async (
  accountId: number,
  proxy: ProxyEntry | null,
  job: TelegramJob,
  emit: (row: TelegramTaskRow) => void,
  signal: AbortSignal,
): Promise<TelegramTaskRow> => {
  const base = { ...blankRow(accountId), state: 'running' as const };
  try {
    return await runOneOrThrow(base, accountId, proxy, job, emit, signal);
  } catch (err) {
    // The outer net for everything the inner one does not cover: `emit` itself.
    log.error(`[telegram/run] account ${accountId} threw out of runOne`, err);
    return { ...base, state: 'failed', ...errorOf(err) };
  }
};

const runOneOrThrow = async (
  base: TelegramTaskRow,
  accountId: number,
  proxy: ProxyEntry | null,
  job: TelegramJob,
  emit: (row: TelegramTaskRow) => void,
  signal: AbortSignal,
): Promise<TelegramTaskRow> => {
  emit({ ...base, step: 'resolving' });

  const resolved = await resolveTelegramAccount(accountId);
  if (!resolved.ok) {
    return {
      ...base,
      state: 'failed',
      error: resolved.reason,
      detail: resolved.message ?? null,
    };
  }

  const attempt = async (): Promise<TelegramTaskRow> => {
    emit({ ...base, step: 'connecting' });
    const payload = await withTelegramClient(
      {
        session: resolved.account.session,
        apiId: resolved.account.apiId,
        apiHash: resolved.account.apiHash,
        deviceModel: resolved.account.deviceModel,
        proxy,
      },
      // Two reasons to stop exist, and a job only gets to honour one signal: the user pressing «отмена».
      (client, clientSignal, keepAlive) =>
        job(
          client,
          resolved.account,
          (step, waitSeconds = null) => emit({ ...base, step, waitSeconds }),
          AbortSignal.any([signal, clientSignal]),
          keepAlive,
        ),
    );
    return {
      ...base,
      state: 'done',
      step: null,
      check: payload.check ?? null,
      filled: payload.filled ?? null,
      cleaned: payload.cleaned ?? null,
      privacy: payload.privacy ?? null,
    };
  };

  /** The second and last try: whatever it throws becomes the row. */
  const retry = async (): Promise<TelegramTaskRow> => {
    try {
      return await attempt();
    } catch (retryErr) {
      return rowFromError(base, retryErr);
    }
  };

  try {
    return await attempt();
  } catch (err) {
    const wait = floodWaitSeconds(err);
    if (wait !== null && wait <= MAX_WAIT_SECONDS && !signal.aborted) {
      emit({ ...base, step: 'waiting', waitSeconds: wait });
      await sleep(wait * 1000 + 500, signal);
      if (signal.aborted) return { ...base, state: 'failed', error: 'cancelled' };
      return await retry();
    }
    // "You are sending too much" with no number attached.
    if (isRateLimitError(err) && !signal.aborted) {
      emit({ ...base, step: 'waiting', waitSeconds: Math.round(RATE_LIMIT_PAUSE_MS / 1000) });
      await sleep(RATE_LIMIT_PAUSE_MS, signal);
      if (signal.aborted) return { ...base, state: 'failed', error: 'cancelled' };
      return await retry();
    }
    // A timeout or a dropped connection is about the link, not about the account.
    if (isRetryableError(err) && !signal.aborted) return await retry();
    return rowFromError(base, err);
  }
};

const rowFromError = (base: TelegramTaskRow, err: unknown): TelegramTaskRow => {
  const wait = floodWaitSeconds(err);
  if (wait !== null) {
    return { ...base, state: 'failed', error: 'flood_wait', detail: null, waitSeconds: wait };
  }
  // A dead key that surfaced outside the checker.
  const deadReason = isDeadKeyError(err);
  if (deadReason) return { ...base, state: 'done', check: deadCheckInfo(deadReason) };
  // So is a freeze. Without this it reads as an ordinary error.
  const frozenReason = isFrozenError(err);
  if (frozenReason) return { ...base, state: 'done', check: frozenCheckInfo(frozenReason) };
  const { error, detail } = errorOf(err);
  log.warn(`[telegram/run] account ${base.accountId} failed: ${detail}`);
  return { ...base, state: 'failed', error, detail };
};

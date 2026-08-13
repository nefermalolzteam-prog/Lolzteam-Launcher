import type { Dialog } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type {
  TelegramCheckInfo,
  TelegramCleanupResult,
  TelegramCleanupTarget,
  TelegramTaskStep,
} from '@shared-types';
import log from 'electron-log/main';
import { sleep } from '../../lib/sleep';
import {
  checkInfoFromUser,
  deadCheckInfo,
  floodWaitSeconds,
  frozenCheckInfo,
  isClientGoneError,
  isDeadIdentityError,
  isFrozenError,
  readFreezeState,
} from './checker';

/** The account Telegram itself writes from — login codes, warnings, terms. */
const SERVICE_NOTIFICATIONS_ID = 777_000;

/** A pause between dialogs. */
const BETWEEN_MS = 350;

/** How many times the list is read before it is accepted as empty. */
const MAX_PASSES = 4;

/** How many contacts go in one `contacts.deleteContacts`. */
const CONTACT_CHUNK = 100;

/** How long one account may spend sitting out Telegram's own limits. */
const FLOOD_BUDGET_MS = 5 * 60_000;

/** A moment past the deadline Telegram named, so the retry is not a second early. */
const FLOOD_SLACK_MS = 1_500;

/** How often a deliberate wait reminds the watchdog that it is a wait. */
const KEEPALIVE_MS = 30_000;

/** A moment between the last write of a pass and the read that confirms it. */
const SETTLE_MS = 2_000;

/** How many surviving dialogs the log names before it stops naming them. */
const STAYED_SAMPLE = 10;

/** How many instalments one dialog's history is emptied in before the run moves on. */
const CLEAR_STEPS = 200;

/** How many times a flood-blocked batch is picked back up. */
const FLOOD_ROUNDS = 3;

export interface CleanupOptions {
  readonly targets: readonly TelegramCleanupTarget[];
  readonly includeArchived: boolean;
  /** Delete private correspondence for the other side as well. */
  readonly revokePrivate: boolean;
}

export interface CleanupOutcome {
  readonly result: TelegramCleanupResult;
  readonly info: TelegramCheckInfo;
}

const EMPTY: TelegramCleanupResult = {
  scanned: 0,
  left: 0,
  deleted: 0,
  contacts: 0,
  folders: 0,
  failed: 0,
};

/** How a dialog is dealt with, once it is known what it is. */
type Action = 'leave' | 'delete';

/** The targets that name a dialog, as opposed to the folders or the address book. */
const DIALOG_TARGETS = [
  'channels',
  'groups',
  'bots',
  'private',
  'saved',
  'service',
] as const satisfies readonly TelegramCleanupTarget[];

/** One dialog, reduced to what acting on it needs. */
interface Job {
  readonly peer: Dialog['peer'];
  readonly target: TelegramCleanupTarget;
  readonly action: Action;
  /** Set when the handling below is a reasoned guess rather than a known quantity, and names the kind that makes it one. */
  readonly note?: string;
}

/** What one read of a dialog concluded. */
type Verdict =
  | {
      readonly kind: 'act';
      readonly target: TelegramCleanupTarget;
      readonly action: Action;
      readonly note?: string;
    }
  | { readonly kind: 'unknown'; readonly what: string };

/** A dialog, said in the least that still identifies it. */
const describePeer = (peer: Dialog['peer']): string =>
  peer.type === 'user' ? `user #${peer.id}` : `${String(peer.chatType)} #${peer.id}`;

/** A dialog that outlived what was done to it, said with what that was. */
const describeJob = (job: Job): string => `${job.target}/${job.action} ${describePeer(job.peer)}`;

/** Empties a dialog to the end of its history, not to the end of the first portion. */
const clearHistory = async (
  client: TelegramClient,
  peer: Dialog['peer'],
  mode: 'delete' | 'revoke',
  signal?: AbortSignal,
): Promise<void> => {
  const target = await client.resolvePeer(peer);
  let rest = Number.POSITIVE_INFINITY;
  for (let step = 0; step < CLEAR_STEPS; step += 1) {
    // Checked inside the loop and not only around it: two hundred requests is minutes of work on one dialog.
    if (signal?.aborted) return;
    const res = await client.call({
      _: 'messages.deleteHistory',
      // `justClear` is what keeps a dialog in the list with its messages gone.
      revoke: mode === 'revoke',
      peer: target,
      maxId: 0,
    });
    if (res.offset === 0) return;
    if (res.offset >= rest) {
      log.warn(
        `[telegram/cleanup] history of ${describePeer(peer)} stopped shrinking at ${res.offset}, leaving the rest`,
      );
      return;
    }
    rest = res.offset;
  }
  // Named rather than counted as a failure: what was asked for did happen, just not all of it.
  log.warn(
    `[telegram/cleanup] history of ${describePeer(peer)} outlasted ${CLEAR_STEPS} calls, the rest goes next run`,
  );
};

/** A legacy group — the kind that is left rather than unsubscribed from. */
const isLegacyGroup = (peer: Dialog['peer']): boolean =>
  peer.type !== 'user' && peer.chatType === 'group';

/** Which switch a dialog answers to, and what doing something about it means. */
const classify = (dialog: Dialog, selfId: number): Verdict => {
  const peer = dialog.peer;
  if (peer.type === 'user') {
    // The account's own notepad.
    if (peer.id === selfId) return { kind: 'act', target: 'saved', action: 'delete' };
    // 777000 and Telegram's support staff: the same category from where the user sits.
    if (peer.id === SERVICE_NOTIFICATIONS_ID || peer.isSupport) {
      return { kind: 'act', target: 'service', action: 'delete' };
    }
    return { kind: 'act', target: peer.isBot ? 'bots' : 'private', action: 'delete' };
  }
  switch (peer.chatType) {
    case 'group':
    case 'supergroup':
    case 'gigagroup':
      return { kind: 'act', target: 'groups', action: 'leave' };
    case 'channel':
      return { kind: 'act', target: 'channels', action: 'leave' };
    case 'monoforum':
      return { kind: 'act', target: 'channels', action: 'leave', note: 'monoforum' };
    // Unreachable as the library's types stand, and kept anyway.
    default:
      return { kind: 'unknown', what: `${peer.type}/${String(peer.chatType)} #${peer.id}` };
  }
};

/** Empties one account's dialog list and address book, as far as the chosen switches allow. */
export const cleanupTelegramAccount = async (
  client: TelegramClient,
  options: CleanupOptions,
  report: (step: TelegramTaskStep, waitSeconds?: number | null) => void,
  signal?: AbortSignal,
  /** Says that a long silence is deliberate. */
  keepAlive?: () => void,
): Promise<CleanupOutcome> => {
  report('me');
  let me: Awaited<ReturnType<TelegramClient['getMe']>>;
  try {
    me = await client.getMe();
  } catch (err) {
    const reason = isDeadIdentityError(err);
    if (reason) return { result: EMPTY, info: deadCheckInfo(reason) };
    const frozen = isFrozenError(err);
    if (frozen) return { result: EMPTY, info: frozenCheckInfo(frozen) };
    throw err;
  }

  // A frozen account answers `getMe` and refuses every write after it.
  const frozen = await readFreezeState(client);
  if (frozen) return { result: EMPTY, info: checkInfoFromUser(me, { frozen }) };

  const wanted = new Set(options.targets);
  const selfId = me.id;
  // Two ledgers, both by peer id.
  const seen = new Set<number>();
  const handled = new Map<number, Job>();
  /** Groups this run has already walked out of. */
  const leftAlready = new Set<number>();
  let left = 0;
  let deleted = 0;
  let contacts = 0;
  let folders = 0;
  let failed = 0;
  // Why the arithmetic does not close.
  let kept = 0;
  let unknown = 0;
  let frozenNow: string | null = null;
  /** The dialogs Telegram told us to come back for, and when. */
  const deferred = new Map<number, { readonly job: Job; readonly readyAt: number }>();
  let floodWaitedMs = 0;

  /** Turns one failed write into a decision about the rest of the run. */
  const survives = (err: unknown, what: string): boolean => {
    frozenNow = isFrozenError(err);
    if (frozenNow) return false;
    // Once the connection is gone every remaining call throws the same thing the moment it is made.
    if (isClientGoneError(err)) {
      log.warn('[telegram/cleanup] connection lost, stopping', err);
      throw err;
    }
    // A channel that cannot be left, a peer that is already gone.
    failed += 1;
    log.warn(`[telegram/cleanup] ${what} failed`, err);
    return true;
  };

  /** Removes the chat folders — the tabs across the top of the list. */
  const wipeFolders = async (): Promise<void> => {
    report('folders');
    let list: Awaited<ReturnType<TelegramClient['getFolders']>>;
    try {
      list = await client.getFolders();
    } catch (err) {
      survives(err, 'reading the folders');
      return;
    }
    // Ids first, and the whole list before the first delete.
    const ids = list.filters.filter((it) => it._ !== 'dialogFilterDefault').map((it) => it.id);
    let first = true;
    for (const id of ids) {
      if (signal?.aborted || frozenNow) return;
      if (!first) await sleep(BETWEEN_MS, signal);
      if (signal?.aborted) return;
      first = false;
      try {
        await client.deleteFolder(id);
        folders += 1;
      } catch (err) {
        if (!survives(err, `deleting folder ${id}`)) return;
      }
    }
  };

  /** Drops every contact, in as few requests as the method allows. */
  const wipeContacts = async (): Promise<void> => {
    report('contacts');
    let book: Awaited<ReturnType<TelegramClient['getContacts']>>;
    try {
      book = await client.getContacts();
    } catch (err) {
      survives(err, 'reading the address book');
      return;
    }
    for (let i = 0; i < book.length; i += CONTACT_CHUNK) {
      if (signal?.aborted || frozenNow) return;
      const chunk = book.slice(i, i + CONTACT_CHUNK);
      try {
        const gone = await client.deleteContacts(chunk);
        contacts += gone.length;
      } catch (err) {
        if (!survives(err, `dropping ${chunk.length} contacts`)) return;
      }
      // Only between chunks: an address book of eighty is one request and no pause at all.
      if (i + CONTACT_CHUNK < book.length) await sleep(BETWEEN_MS, signal);
    }
  };

  /** Reads every list without touching one, and answers with the work. */
  const collect = async (
    walks: readonly {
      readonly archived: 'exclude' | 'only';
      readonly pinned: 'exclude' | 'only';
    }[],
  ): Promise<{ jobs: Map<number, Job>; stayed: Map<number, string> }> => {
    const jobs = new Map<number, Job>();
    const stayed = new Map<number, string>();
    for (const it of walks) {
      for await (const dialog of client.iterDialogs({ archived: it.archived, pinned: it.pinned })) {
        if (signal?.aborted) return { jobs, stayed };
        const id = dialog.peer.id;
        const first = !seen.has(id);
        seen.add(id);
        if (handled.has(id) || jobs.has(id)) {
          // Two things are still listed for reasons that are not survival, and both would otherwise cry wolf on every single run.
          const done = handled.get(id);
          if (done && !deferred.has(id) && id !== selfId) stayed.set(id, describeJob(done));
          continue;
        }
        const verdict = classify(dialog, selfId);
        if (verdict.kind === 'unknown') {
          if (first) {
            unknown += 1;
            // Warned rather than counted quietly: a chat type this file has no branch for is the one thing here that a user cannot.
            log.warn(`[telegram/cleanup] unrecognised dialog, left alone: ${verdict.what}`);
          }
          continue;
        }
        if (!wanted.has(verdict.target)) {
          if (first) kept += 1;
          continue;
        }
        jobs.set(id, {
          peer: dialog.peer,
          target: verdict.target,
          action: verdict.action,
          ...(verdict.note === undefined ? {} : { note: verdict.note }),
        });
      }
    }
    return { jobs, stayed };
  };

  /** How one attempt at one dialog ended. */
  type Attempt = 'ok' | 'failed' | 'deferred' | 'stop';

  /** Says how a dialog whose handling was a guess actually went. */
  const noted = new Set<string>();
  const sayHow = (job: Job, how: string): void => {
    if (job.note === undefined || noted.has(job.note)) return;
    noted.add(job.note);
    log.info(`[telegram/cleanup] ${job.note} #${job.peer.id}: ${job.action} → ${how}`);
  };

  /** Does the one thing this dialog needs, and reads the refusal if there is one. */
  const attempt = async (id: number, job: Job): Promise<Attempt> => {
    try {
      if (job.action === 'leave') {
        // Two steps for a legacy group, and only the second one removes it from the list.
        if (!leftAlready.has(id)) {
          await client.leaveChat(job.peer);
          leftAlready.add(id);
        }
        if (isLegacyGroup(job.peer)) await clearHistory(client, job.peer, 'delete', signal);
        left += 1;
      } else {
        // `revoke` erases the other side's copy as well; `delete` only ours.
        const mode = job.target === 'private' && options.revokePrivate ? 'revoke' : 'delete';
        await clearHistory(client, job.peer, mode, signal);
        deleted += 1;
      }
      sayHow(job, 'ok');
      return 'ok';
    } catch (err) {
      const wait = floodWaitSeconds(err);
      if (wait !== null) {
        deferred.set(id, { job, readyAt: Date.now() + wait * 1000 + FLOOD_SLACK_MS });
        return 'deferred';
      }
      sayHow(job, `refused: ${String(err)}`);
      return survives(err, `${job.action} for ${id}`) ? 'failed' : 'stop';
    }
  };

  /** Works through what a read found. */
  const act = async (jobs: ReadonlyMap<number, Job>): Promise<number> => {
    let acted = 0;
    let first = true;
    for (const [id, job] of jobs) {
      if (signal?.aborted || frozenNow) break;
      // The pause belongs between two writes, not before the first one.
      if (!first) await sleep(BETWEEN_MS, signal);
      if (signal?.aborted) break;
      first = false;
      const how = await attempt(id, job);
      if (how === 'stop') break;
      if (how === 'ok') acted += 1;
      // Marked whatever happened — acted on, given up.
      handled.set(id, job);
    }
    return acted;
  };

  /** A wait that outlasts the watchdog without looking like a dead connection. */
  const patientSleep = async (ms: number): Promise<void> => {
    let remaining = ms;
    while (remaining > 0 && !signal?.aborted) {
      const slice = Math.min(remaining, KEEPALIVE_MS);
      await sleep(slice, signal);
      remaining -= slice;
      keepAlive?.();
    }
  };

  /** Comes back for the dialogs Telegram put off, once it said they could be. */
  const drain = async (): Promise<number> => {
    let done = 0;
    for (let round = 0; round < FLOOD_ROUNDS; round += 1) {
      if (deferred.size === 0 || signal?.aborted || frozenNow) break;
      const readyAt = Math.min(...[...deferred.values()].map((it) => it.readyAt));
      const waitMs = readyAt - Date.now();
      if (waitMs > 0) {
        // Out of patience rather than out of options: what is left keeps its place in the count.
        if (floodWaitedMs + waitMs > FLOOD_BUDGET_MS) break;
        floodWaitedMs += waitMs;
        report('waiting', Math.ceil(waitMs / 1000));
        await patientSleep(waitMs);
        if (signal?.aborted || frozenNow) break;
      }
      report('leaving');
      // Taken out before the retry so that anything Telegram puts off *again* lands in an empty map with a fresh deadline.
      const wave = new Map([...deferred].map(([id, it]) => [id, it.job]));
      deferred.clear();
      done += await act(wave);
    }
    return done;
  };

  // The address book first: cheap, self-contained.
  if (wanted.has('contacts')) await wipeContacts();
  if (wanted.has('folders') && !frozenNow && !signal?.aborted) await wipeFolders();

  // Each folder is asked for by name rather than left to the server's default.
  const archives = options.includeArchived
    ? (['exclude', 'only'] as const)
    : (['exclude'] as const);
  // And pinned dialogs are their own walk, never part of the main one.
  const walks = archives.flatMap(
    (archived) =>
      [
        { archived, pinned: 'exclude' },
        { archived, pinned: 'only' },
      ] as const,
  );

  let passes = 0;
  /** What each read found to do, in order. */
  const found: number[] = [];
  /** What the last read still saw after it had been dealt with. */
  let stayed = new Map<number, string>();
  // Skipped outright when nothing selected names a dialog.
  if (DIALOG_TARGETS.some((it) => wanted.has(it))) {
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      if (signal?.aborted || frozenNow) break;
      passes = pass + 1;
      // Not before the first read — there is nothing yet for the server to have caught up with.
      if (pass > 0) await sleep(SETTLE_MS, signal);
      if (signal?.aborted) break;
      report('dialogs');
      const read = await collect(walks);
      const jobs = read.jobs;
      stayed = read.stayed;
      found.push(jobs.size);
      if (jobs.size === 0 && deferred.size === 0) break;
      report('leaving');
      const acted = await act(jobs);
      // Inside the loop rather than after it: a dialog that only came off on the retry deserves the same confirming read as one.
      const drained = await drain();
      // A pass that got through nothing is a pass that will get through nothing next time either.
      if (acted + drained === 0) break;
    }
  }

  // Whatever is still waiting has run out of the run's patience rather than out of chances.
  if (deferred.size > 0) {
    failed += deferred.size;
    log.warn(
      `[telegram/cleanup] ${deferred.size} dialogs still flood-limited after ${Math.round(
        floodWaitedMs / 1000,
      )}s of waiting`,
    );
  }

  // What Telegram said yes to and then went on listing anyway.
  if (stayed.size > 0) {
    log.warn(
      `[telegram/cleanup] ${stayed.size} dialogs still listed after being acted on: ${[
        ...stayed.values(),
      ]
        .slice(0, STAYED_SAMPLE)
        .join(', ')}${stayed.size > STAYED_SAMPLE ? ', …' : ''}`,
    );
  }

  // Read back for the same reason a fill does: this is what the account list will show next.
  const result: TelegramCleanupResult = {
    scanned: seen.size,
    left,
    deleted,
    contacts,
    folders,
    failed,
  };
  // The line that makes «почистило, но не всё» an answerable question.
  log.info(
    `[telegram/cleanup] #${me.id}: scanned=${result.scanned} left=${result.left} deleted=${
      result.deleted
    } contacts=${result.contacts} folders=${result.folders} failed=${result.failed} kept=${kept} unknown=${unknown} stayed=${stayed.size} passes=${passes}[${found.join(',')}]${
      floodWaitedMs > 0 ? ` floodWait=${Math.round(floodWaitedMs / 1000)}s` : ''
    }${frozenNow ? ` frozen=${frozenNow}` : ''}${signal?.aborted ? ' cancelled' : ''}`,
  );
  return {
    result,
    info: frozenNow ? checkInfoFromUser(me, { frozen: frozenNow }) : checkInfoFromUser(me),
  };
};

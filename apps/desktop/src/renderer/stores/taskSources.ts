import { serviceLabel } from '@shared-types';
import { useEffect } from 'react';
import { serviceLogo } from '~/lib/serviceLogos';
import { type StreamProgress, streamKey, useAccountsStream } from './accountsStream';
import { useLoginSession } from './loginSession';
import { cancelProxyChecks, useProxyChecks } from './proxyChecks';
import { type TaskChild, type TaskSync, type TaskText, useTasks } from './tasks';
import { cancelTelegramRun, useTelegramTasks } from './telegramTasks';
import { useUpdater } from './updater';

/** Where the dock's tasks come from. */
export type TaskSource = (sync: TaskSync) => () => void;

/** Subscribes `emit` to a store and runs it once for the state already there. */
const watch = (subscribe: (listener: () => void) => () => void, emit: () => void): (() => void) => {
  emit();
  return subscribe(emit);
};

/** The second line under a category. */
const childDetail = (
  state: TaskChild['state'],
  live: StreamProgress | undefined,
  count: number,
): TaskText => {
  if (state === 'failed') return { key: 'tasks.accounts.childFailed' };
  if (state === 'waiting') return { key: 'tasks.accounts.childWaiting' };
  if (state === 'done') return { key: 'tasks.accounts.childDone', params: { loaded: count } };
  if (live && live.totalPages !== null && live.totalPages > 1)
    return {
      key: 'tasks.accounts.detailPage',
      params: { page: live.page, total: live.totalPages, loaded: count },
    };
  return { key: 'tasks.accounts.detail', params: { loaded: count } };
};

/** Loading the market inventory — one bundled task, one child per category. */
const accountsSource: TaskSource = (sync) =>
  watch(useAccountsStream.subscribe, () => {
    const st = useAccountsStream.getState();
    const plan = st.plan;
    if (!st.streaming || plan === null) {
      sync('accounts', []);
      return;
    }

    let progress = 0;
    let settled = 0;
    let loaded = 0;

    const children = plan.services.map((service): TaskChild => {
      const key = streamKey(plan.scope, service);
      const live = st.progress.get(service);
      const failed = st.failed.has(key);
      // `loaded` is set the moment a category reports `categoryDone`.
      const done = st.loaded.has(key);
      const count = st.streamed.get(key)?.length ?? 0;
      loaded += count;

      const state: TaskChild['state'] = done
        ? failed
          ? 'failed'
          : 'done'
        : live
          ? 'running'
          : 'waiting';
      if (done) {
        progress += 1;
        settled += 1;
      } else if (live && live.totalPages !== null && live.totalPages > 0) {
        progress += Math.min(1, live.page / live.totalPages);
      }

      return {
        id: `accounts:${service}`,
        title: { key: 'tasks.accounts.title', params: { service: serviceLabel(service) } },
        // The category's own logo, resolved here rather than in the dock.
        logo: serviceLogo(service),
        state,
        detail: childDetail(state, live, count),
        done: live?.page ?? 0,
        total: live?.totalPages ?? null,
      };
    });

    sync('accounts', [
      {
        id: `accounts:${plan.scope}`,
        kind: 'accounts',
        title: {
          key:
            plan.scope === 'listed'
              ? 'tasks.accounts.bundleListed'
              : 'tasks.accounts.bundlePurchased',
        },
        detail: {
          key: 'tasks.accounts.bundleDetail',
          params: { done: settled, total: plan.services.length, loaded },
        },
        // Fractional on purpose: the unit is «categories».
        done: progress,
        total: plan.services.length,
        children,
      },
    ]);
  });

/** A «База» run — a check, a cleanup, a friends purge. */
const runSource: TaskSource = (sync) =>
  watch(useTelegramTasks.subscribe, () => {
    const st = useTelegramTasks.getState();
    if (!st.running || st.runId === null || st.kind === null) {
      sync('run', []);
      return;
    }
    const settled = [...st.rows.values()].filter(
      (r) => r.state !== 'queued' && r.state !== 'running',
    ).length;
    // The rows arrive with the run rather than before it, so an empty map is "not told yet", not "nothing to do".
    const total = st.rows.size > 0 ? st.rows.size : null;
    sync('run', [
      {
        id: `run:${st.runId}`,
        kind: 'run',
        title: { key: `tasks.run.${st.kind}` },
        detail:
          total === null ? null : { key: 'tasks.run.detail', params: { done: settled, total } },
        done: settled,
        total,
        cancel: cancelTelegramRun,
      },
    ]);
  });

/** One account being logged into. */
const loginSource: TaskSource = (sync) =>
  watch(useLoginSession.subscribe, () => {
    const st = useLoginSession.getState();
    const live = st.isOpen && st.step !== 'done' && st.error === null;
    sync(
      'login',
      live
        ? [
            {
              id: 'login',
              kind: 'login',
              title: { key: 'tasks.login.title' },
              detail: st.accountTitle
                ? { key: 'tasks.login.detail', params: { account: st.accountTitle } }
                : null,
              done: 0,
              total: null,
            },
          ]
        : [],
    );
  });

/** The updater, while it is actually pulling bytes. */
const updateSource: TaskSource = (sync) =>
  watch(useUpdater.subscribe, () => {
    const status = useUpdater.getState().status;
    sync(
      'update',
      status?.state === 'downloading'
        ? [
            {
              id: 'update',
              kind: 'update',
              title: { key: 'tasks.update.title' },
              detail: {
                key: 'tasks.update.detail',
                params: { percent: Math.round(status.percent) },
              },
              done: status.transferred,
              total: status.total > 0 ? status.total : null,
            },
          ]
        : [],
    );
  });

/** A bulk proxy check. */
const proxySource: TaskSource = (sync) =>
  watch(useProxyChecks.subscribe, () => {
    const run = useProxyChecks.getState().run;
    sync(
      'proxy',
      run
        ? [
            {
              id: `proxy:${run.id}`,
              kind: 'proxy',
              title: { key: 'tasks.proxy.title' },
              detail: {
                key: run.cancelled ? 'tasks.proxy.stopping' : 'tasks.proxy.detail',
                params: { done: run.done, total: run.total },
              },
              done: run.done,
              total: run.total,
              // Nothing left to ask for once it has been asked once.
              ...(run.cancelled ? {} : { cancel: cancelProxyChecks }),
            },
          ]
        : [],
    );
  });

export const TASK_SOURCES: readonly TaskSource[] = [
  accountsSource,
  runSource,
  loginSource,
  updateSource,
  proxySource,
];

/** Runs every source for as long as the shell is mounted. */
export const useTaskCenter = (): void => {
  useEffect(() => {
    const sync = useTasks.getState().sync;
    const offs = TASK_SOURCES.map((source) => source(sync));
    return () => {
      for (const off of offs) off();
      useTasks.getState().clear();
    };
  }, []);
};

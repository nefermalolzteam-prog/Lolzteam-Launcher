import { useEffect } from 'react';
import { streamKey, useAccountsStream } from './accountsStream';
import { useLoginSession } from './loginSession';
import { type NotificationDraft, notify } from './notifications';
import { useProxyChecks } from './proxyChecks';
import { useTelegramTasks } from './telegramTasks';
import { useUpdater } from './updater';

/** Where notifications come from. */
export type NotifySource = (emit: (draft: NotificationDraft) => void) => () => void;

/** Subscribes and, unlike the dock's `watch`, does **not** run once for the state already there. */
const watch = (subscribe: (listener: () => void) => () => void, on: () => void): (() => void) =>
  subscribe(on);

/** A refresh the user pressed, once it has finished. */
const accountsSource: NotifySource = (emit) => {
  let prev: { id: number; complete: boolean } | null = null;
  return watch(useAccountsStream.subscribe, () => {
    const st = useAccountsStream.getState();
    const plan = st.plan;
    if (plan === null) {
      prev = null;
      return;
    }

    let loaded = 0;
    let failed = 0;
    for (const service of plan.services) {
      const key = streamKey(plan.scope, service);
      loaded += st.streamed.get(key)?.length ?? 0;
      if (st.failed.has(key)) failed += 1;
    }
    const complete = plan.services.every((s) => st.loaded.has(streamKey(plan.scope, s)));

    const before = prev;
    prev = { id: st.streamId, complete };
    if (!plan.announce) return;
    // A stream we have not watched from the start cannot have an edge yet.
    if (before === null || before.id !== st.streamId || before.complete || !complete) return;

    emit({
      category: 'accounts',
      level: failed > 0 ? 'warning' : 'success',
      title: {
        key: plan.scope === 'listed' ? 'notify.accounts.titleListed' : 'notify.accounts.title',
      },
      body:
        failed > 0
          ? { key: 'notify.accounts.bodyFailed', params: { loaded, failed } }
          : { key: 'notify.accounts.body', params: { loaded } },
    });
  });
};

/** One account's login, when it stops. */
const loginSource: NotifySource = (emit) => {
  let step: string | null = null;
  let error: string | null = null;
  return watch(useLoginSession.subscribe, () => {
    const st = useLoginSession.getState();
    const [wasStep, wasError] = [step, error];
    step = st.step;
    error = st.error;
    const account = st.accountTitle;

    if (st.error !== null && wasError === null) {
      emit({
        category: 'login',
        level: 'warning',
        title: { key: 'notify.login.failed' },
        body: account ? { key: 'notify.login.account', params: { account } } : null,
      });
      return;
    }
    // `close()` clears both fields, so only a real arrival at `done` gets here.
    if (st.step === 'done' && wasStep !== 'done' && st.error === null) {
      emit({
        category: 'login',
        level: 'success',
        title: { key: 'notify.login.done' },
        body: account ? { key: 'notify.login.account', params: { account } } : null,
      });
    }
  });
};

/** A «База» run that has finished — a check, a cleanup, a friends purge. */
const runSource: NotifySource = (emit) => {
  let running = false;
  let runId: string | null = null;
  return watch(useTelegramTasks.subscribe, () => {
    const st = useTelegramTasks.getState();
    const [wasRunning, wasId] = [running, runId];
    running = st.running;
    runId = st.runId;

    if (!wasRunning || st.running) return;
    if (st.runId === null || st.runId !== wasId) return;
    const summary = st.summary;
    if (summary === null || st.kind === null) return;

    emit({
      category: 'run',
      level: summary.failed > 0 || summary.stopped !== null ? 'warning' : 'success',
      title: { key: `notify.run.${st.kind}` },
      body:
        summary.stopped !== null
          ? {
              key: 'notify.run.bodyStopped',
              params: { ok: summary.ok, failed: summary.failed, skipped: summary.skipped },
            }
          : { key: 'notify.run.body', params: { ok: summary.ok, failed: summary.failed } },
    });
  });
};

/** The updater, at the two moments it wants something from the user. */
const updateSource: NotifySource = (emit) => {
  let state: string | null = null;
  return watch(useUpdater.subscribe, () => {
    const status = useUpdater.getState().status;
    const was = state;
    state = status?.state ?? null;
    if (status === null || status.state === was) return;

    if (status.state === 'available') {
      emit({
        category: 'update',
        level: 'info',
        title: { key: 'notify.update.available' },
        body: { key: 'notify.update.version', params: { version: status.version } },
      });
    } else if (status.state === 'downloaded') {
      emit({
        category: 'update',
        level: 'success',
        title: { key: 'notify.update.downloaded' },
        body: { key: 'notify.update.version', params: { version: status.version } },
      });
    }
  });
};

/** A bulk proxy check, once the last answer is in. */
const proxySource: NotifySource = (emit) => {
  let last: { id: string; done: number; ok: number; total: number; cancelled: boolean } | null =
    null;
  return watch(useProxyChecks.subscribe, () => {
    const run = useProxyChecks.getState().run;
    const before = last;
    last = run === null ? null : { ...run };
    if (before === null || (run !== null && run.id === before.id)) return;
    // Stopped before the first answer landed: nothing was learnt, so there is nothing to report.
    if (before.done === 0) return;

    emit({
      category: 'proxy',
      level: before.cancelled || before.ok < before.done ? 'warning' : 'success',
      title: { key: before.cancelled ? 'notify.proxy.stopped' : 'notify.proxy.done' },
      body: {
        key: 'notify.proxy.body',
        params: { ok: before.ok, done: before.done, total: before.total },
      },
    });
  });
};

export const NOTIFY_SOURCES: readonly NotifySource[] = [
  accountsSource,
  loginSource,
  runSource,
  updateSource,
  proxySource,
];

/** Runs every source for as long as the shell is mounted. */
export const useNotificationCenter = (): void => {
  useEffect(() => {
    const offs = NOTIFY_SOURCES.map((source) => source(notify));
    return () => {
      for (const off of offs) off();
    };
  }, []);
};

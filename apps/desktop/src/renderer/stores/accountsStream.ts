import type {
  AccountScope,
  AccountSummary,
  LauncherSettings,
  MarketScope,
  ServiceId,
  SupportedServiceId,
} from '@shared-types';
import { SUPPORTED_SERVICE_IDS, isSupportedServiceId } from '@shared-types';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';
import { useSettings } from './settings';

/** Streamed categories, derived from the service registry. */
export const STREAM_SERVICES = SUPPORTED_SERVICE_IDS;
export type StreamService = SupportedServiceId;

export const isStreamService = (id: ServiceId | null): id is StreamService =>
  isSupportedServiceId(id);

// Accumulators are keyed by scope+service so the two scopes (purchased/listed) stream and cache independently.
type StreamKey = `${MarketScope}:${StreamService}`;
export const streamKey = (scope: MarketScope, service: StreamService): StreamKey =>
  `${scope}:${service}`;
const scopeOf = (it: AccountSummary): AccountScope => it.scope ?? 'purchased';

export interface StreamProgress {
  service: StreamService;
  page: number;
  totalPages: number | null;
  count: number;
}

/** How far each category currently is, keyed by service. */
export type StreamProgressMap = ReadonlyMap<StreamService, StreamProgress>;

/** What the stream that is running set out to do. */
export interface StreamPlan {
  readonly scope: MarketScope;
  readonly services: readonly StreamService[];
  /** Say something when this one finishes. */
  readonly announce: boolean;
}

interface AccountsStreamState {
  streaming: boolean;
  streamId: number;
  activeScope: AccountScope;
  launchHandled: boolean;
  preloadScope: MarketScope | null;
  loaded: ReadonlySet<StreamKey>;
  /** Categories that finished by giving up rather than by running out of pages. */
  failed: ReadonlySet<StreamKey>;
  streamed: Map<StreamKey, AccountSummary[]>;
  progress: StreamProgressMap;
  /** The running stream's plan, or `null` when nothing is streaming. */
  plan: StreamPlan | null;
  setStreaming: (streaming: boolean) => void;
  setStreamId: (streamId: number) => void;
  setActiveScope: (scope: AccountScope) => void;
  setLaunchHandled: (launchHandled: boolean) => void;
  setPreloadScope: (scope: MarketScope | null) => void;
  setLoaded: (updater: (prev: ReadonlySet<StreamKey>) => ReadonlySet<StreamKey>) => void;
  setFailed: (updater: (prev: ReadonlySet<StreamKey>) => ReadonlySet<StreamKey>) => void;
  /** Posts one category's position. */
  setProgress: (progress: StreamProgress) => void;
  /** Retires one category, or all of them when the stream ends. */
  clearProgress: (service?: StreamService) => void;
  setPlan: (plan: StreamPlan | null) => void;
  resetAccumulator: () => void;
  reset: () => void;
}

export const useAccountsStream = create<AccountsStreamState>((set) => ({
  streaming: false,
  streamId: 0,
  activeScope: 'purchased',
  launchHandled: false,
  preloadScope: null,
  loaded: new Set(),
  failed: new Set(),
  streamed: new Map(),
  progress: new Map(),
  plan: null,
  setStreaming: (streaming) => set({ streaming }),
  setStreamId: (streamId) => set({ streamId }),
  setActiveScope: (activeScope) => set({ activeScope }),
  setLaunchHandled: (launchHandled) => set({ launchHandled }),
  setPreloadScope: (preloadScope) => set({ preloadScope }),
  setLoaded: (updater) => set((s) => ({ loaded: updater(s.loaded) })),
  setFailed: (updater) => set((s) => ({ failed: updater(s.failed) })),
  setProgress: (progress) =>
    set((s) => ({ progress: new Map(s.progress).set(progress.service, progress) })),
  clearProgress: (service) =>
    set((s) => {
      if (service === undefined) return s.progress.size === 0 ? s : { progress: new Map() };
      if (!s.progress.has(service)) return s;
      const next = new Map(s.progress);
      next.delete(service);
      return { progress: next };
    }),
  setPlan: (plan) => set({ plan }),
  resetAccumulator: () => set({ streamed: new Map() }),
  reset: () =>
    set({
      streaming: false,
      preloadScope: null,
      loaded: new Set(),
      failed: new Set(),
      streamed: new Map(),
      progress: new Map(),
      plan: null,
    }),
}));

let streamSeq = 0;

const reportedUnknownServices = new Set<string>();

/** Warns once per unknown service id so a registry mismatch is visible in devtools. */
const reportUnknownStreamService = (serviceId: ServiceId, dropped: number): void => {
  const key = String(serviceId);
  if (reportedUnknownServices.has(key)) return;
  reportedUnknownServices.add(key);
  const hint =
    'The renderer and main disagree about the registry — check packages/shared-types/src/service-registry.ts.';
  console.warn(
    `[accounts] main streamed unknown service "${key}" (${dropped} item(s) dropped). ${hint}`,
  );
};

/** Has this scope finished streaming all its categories? */
export const isScopeLoaded = (loaded: ReadonlySet<StreamKey>, scope: AccountScope): boolean =>
  scope === 'local' || STREAM_SERVICES.every((id) => loaded.has(streamKey(scope, id)));

/** Did any category of this scope give up? */
export const isScopeFailed = (failed: ReadonlySet<StreamKey>, scope: AccountScope): boolean =>
  scope !== 'local' && STREAM_SERVICES.some((id) => failed.has(streamKey(scope, id)));

export const mergeWithStream = (base: AccountSummary[]): AccountSummary[] => {
  const touched = useAccountsStream.getState().streamed;
  const keys = new Set(touched.keys());
  const kept = base.filter((it) => {
    const scope = scopeOf(it);
    // Locally added accounts are outside every stream, so nothing evicts them.
    if (scope === 'local' || !isStreamService(it.category)) return true;
    return !keys.has(streamKey(scope, it.category));
  });
  return [...kept, ...[...touched.values()].flat()];
};

export const startAccountsStream = (
  only?: StreamService,
  scope: MarketScope = 'purchased',
  opts?: { keepActiveScope?: boolean; announce?: boolean },
) => {
  const st = useAccountsStream.getState();
  if (st.streaming) return;
  const id = ++streamSeq;
  st.setStreaming(true);
  st.setStreamId(id);
  if (!opts?.keepActiveScope) st.setActiveScope(scope);
  st.clearProgress();
  // Stated before the first request goes out, so the dock can say «0 из 6» from the first frame instead of waiting.
  st.setPlan({
    scope,
    services: only ? [only] : STREAM_SERVICES,
    announce: opts?.announce === true,
  });
  // A re-stream is a second chance: whatever failed last time is no longer the answer.
  const forget = (prev: ReadonlySet<StreamKey>, pred: (k: StreamKey) => boolean) => {
    const next = new Set(prev);
    for (const k of prev) if (pred(k)) next.delete(k);
    return next;
  };
  if (only) {
    const key = streamKey(scope, only);
    st.setLoaded((prev) => forget(prev, (k) => k === key));
    st.setFailed((prev) => forget(prev, (k) => k === key));
    st.streamed.delete(key);
  } else {
    // Re-stream the whole scope: drop just this scope's keys, keep the other's.
    const mine = (k: StreamKey) => k.startsWith(`${scope}:`);
    st.setLoaded((prev) => forget(prev, mine));
    st.setFailed((prev) => forget(prev, mine));
    for (const k of [...st.streamed.keys()]) if (mine(k)) st.streamed.delete(k);
  }
  void window.launcher.accounts.listStream(only, scope, id).catch(() => {
    if (useAccountsStream.getState().streamId === id)
      useAccountsStream.getState().setStreaming(false);
  });
};

export const restartAccountsStream = (scope?: MarketScope) => {
  const st = useAccountsStream.getState();
  // The local tab has nothing to re-stream.
  const substituted = scope === undefined && st.activeScope === 'local';
  const target = scope ?? (st.activeScope === 'local' ? 'purchased' : st.activeScope);
  st.setStreaming(false);
  startAccountsStream(undefined, target, substituted ? { keepActiveScope: true } : undefined);
};

/** Wiping the on-disk cache leaves the renderer with nothing to show. */
export const clearAccountsCacheAndRestream = async (qc: QueryClient): Promise<void> => {
  await window.launcher.accounts.clearCache();
  useAccountsStream.getState().reset();
  qc.setQueryData<AccountSummary[]>(['accounts'], (prev) =>
    (prev ?? []).filter((it) => scopeOf(it) === 'local'),
  );
  restartAccountsStream();
};

const appProxySignature = (settings: LauncherSettings): string => {
  const p = settings.appProxyId
    ? settings.proxies.find((x) => x.id === settings.appProxyId)
    : undefined;
  return p
    ? `${p.protocol ?? 'http'}://${p.host}:${p.port}:${p.username ?? ''}:${p.password ?? ''}`
    : 'direct';
};

export const useAccountsStreamController = () => {
  const qc = useQueryClient();

  useEffect(() => {
    const rebuild = () =>
      qc.setQueryData<AccountSummary[]>(['accounts'], (prev) => mergeWithStream(prev ?? []));

    const off = window.launcher.accounts.onCategory(
      ({
        streamId,
        serviceId,
        scope,
        items,
        categoryDone,
        done,
        page,
        totalPages,
        failed: categoryFailed,
      }) => {
        const st = useAccountsStream.getState();
        if (streamId !== st.streamId) return;
        if (!isStreamService(serviceId)) {
          // Main streamed a category the renderer does not know how to display.
          reportUnknownStreamService(serviceId, items.length);
          if (done) {
            st.setStreaming(false);
            st.clearProgress();
          }
          return;
        }
        const key = streamKey(scope, serviceId);
        if (items.length > 0) {
          const acc = st.streamed.get(key) ?? [];
          acc.push(...items);
          st.streamed.set(key, acc);
          rebuild();
        }
        if (!categoryDone && page !== undefined) {
          st.setProgress({
            service: serviceId,
            page,
            totalPages: totalPages ?? null,
            count: (st.streamed.get(key) ?? []).length,
          });
        }
        if (categoryDone) {
          // The category has nothing left to report, so its row leaves the dock — the ones still walking keep theirs.
          st.clearProgress(serviceId);
          if (!st.streamed.has(key)) {
            st.streamed.set(key, []);
            rebuild();
          }
          st.setLoaded((prev) => new Set(prev).add(key));
          st.setFailed((prev) => {
            const isFailed = categoryFailed === true;
            if (isFailed === prev.has(key)) return prev;
            const next = new Set(prev);
            if (isFailed) next.add(key);
            else next.delete(key);
            return next;
          });
        }
        if (done) {
          st.setStreaming(false);
          st.clearProgress();
          const next = useAccountsStream.getState().preloadScope;
          if (next && next !== scope) {
            useAccountsStream.getState().setPreloadScope(null);
            if (!isScopeLoaded(useAccountsStream.getState().loaded, next))
              startAccountsStream(undefined, next, { keepActiveScope: true });
          } else if (next) {
            useAccountsStream.getState().setPreloadScope(null);
          }
        }
      },
    );

    let cancelled = false;
    if (!useAccountsStream.getState().launchHandled) {
      void (async () => {
        const settingsResp = await window.launcher.settings.get();
        if (cancelled || useAccountsStream.getState().launchHandled) return;
        const refreshOnLaunch = settingsResp.settings.refreshOnLaunch ?? true;
        /** «Не обновлять при запуске» means «show me the cache». */
        const cached = refreshOnLaunch
          ? null
          : await window.launcher.accounts.cacheStatus().catch(() => null);
        if (cancelled || useAccountsStream.getState().launchHandled) return;
        // A failed status read is treated as «no cache»: fetching when we did not have to costs a request.
        const skipFetch = !refreshOnLaunch && cached?.hasCache === true;
        if (skipFetch) {
          useAccountsStream
            .getState()
            .setLoaded(
              () =>
                new Set([
                  ...STREAM_SERVICES.map((id) => streamKey('purchased', id)),
                  ...STREAM_SERVICES.map((id) => streamKey('listed', id)),
                ]),
            );
        } else {
          if (!refreshOnLaunch) {
            console.info('[accounts] refresh-on-launch is off but there is no cache — fetching');
          }
          useAccountsStream.getState().setPreloadScope('listed');
          startAccountsStream(undefined, 'purchased');
        }
        useAccountsStream.getState().setLaunchHandled(true);
      })();
    }

    return () => {
      cancelled = true;
      off();
    };
  }, [qc]);

  const bgMinutes = useSettings((s) => s.settings?.backgroundRefreshMinutes ?? 0);
  useEffect(() => {
    if (!bgMinutes || bgMinutes <= 0) return;
    const id = setInterval(() => {
      if (!useAccountsStream.getState().streaming) restartAccountsStream();
    }, bgMinutes * 60_000);
    return () => clearInterval(id);
  }, [bgMinutes]);

  useEffect(() => {
    const sigOf = (s: LauncherSettings | null): string | null => (s ? appProxySignature(s) : null);
    let prev = sigOf(useSettings.getState().settings);
    const unsub = useSettings.subscribe((state) => {
      const sig = sigOf(state.settings);
      if (sig === null) return;
      if (prev === null) {
        prev = sig;
        return;
      }
      if (sig === prev) return;
      prev = sig;
      void clearAccountsCacheAndRestream(qc);
    });
    return unsub;
  }, [qc]);
};

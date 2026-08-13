import { IPC_CHANNELS } from '@shared-ipc';
import type { AccountsCategoryEvent } from '@shared-ipc';
import { SERVICE_CATEGORY_ID, SUPPORTED_SERVICE_IDS } from '@shared-types';
import type {
  AccountDetails,
  AccountPreview,
  AccountScope,
  AccountSummary,
  MailCredentials,
  MarketScope,
  ServiceId,
} from '@shared-types';
import { type IpcMainInvokeEvent, ipcMain } from 'electron';
import log from 'electron-log/main';
import { listLocalLabels } from '../accounts/label-store';
import type { LocalProjectionContext } from '../accounts/local-projection';
import { toSummary } from '../accounts/local-projection';
import { listLocalAccountFolders, listLocalAccounts } from '../accounts/local-store';
import { indexCopies, stampCopies } from '../accounts/market-copy';
import { onTokenChange } from '../auth/token-store';
import {
  cachedAccountsStatus,
  clearCachedAccounts,
  loadCachedAccounts,
  patchCachedAccount,
  saveCachedAccounts,
} from '../services/accounts-cache-store';
import { recordAction } from '../services/action-log';
import { mailboxFor } from '../services/mailbox';
import {
  addItemTag,
  checkAccountValidity,
  getAccountDetails,
  listAccountsByCategory,
  listPurchasedAccounts,
  removeItemTag,
  setAccountNote,
} from '../services/market';
import { getSettings } from '../settings/settings-store';
import { handleAction } from './handle-action';

const STREAM_ORDER: readonly ServiceId[] = SUPPORTED_SERVICE_IDS;

let inflight: Promise<AccountSummary[]> | null = null;

const fetchAndCache = (): Promise<AccountSummary[]> => {
  if (inflight) return inflight;
  const p = listPurchasedAccounts()
    .then(async ({ items, complete }) => {
      if (!complete) {
        log.warn(
          `[accounts] refresh returned ${items.length} accounts but did not finish; keeping the cache`,
        );
        return items;
      }
      // Replace only the purchased slice; keep any cached listed items.
      const cached = (await loadCachedAccounts())?.items ?? [];
      const kept = cached.filter((it) => (it.scope ?? 'purchased') !== 'purchased');
      await saveCachedAccounts([...kept, ...items]);
      return items;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = p;
  return p;
};

const loadCached = async (): Promise<AccountSummary[]> => {
  const cached = await loadCachedAccounts();
  return cached?.items ?? [];
};

const listLocalSummaries = async (): Promise<AccountSummary[]> => {
  const [records, labels] = await Promise.all([listLocalAccounts(), listLocalLabels()]);
  const folders = await listLocalAccountFolders();
  const ctx: LocalProjectionContext = {
    labels: new Map(labels.map((l) => [l.id, l])),
    folders: new Map(folders.map((f) => [f.id, f.group])),
  };
  return records.map((record) => toSummary(record, ctx));
};

const listAllAccounts = async (): Promise<AccountSummary[]> => {
  const [market, local] = await Promise.all([loadCached(), listLocalSummaries()]);
  const index = indexCopies(local.map((it) => ({ id: it.itemId, marketItemId: it.marketItemId })));
  return [...stampCopies(market, index), ...local];
};

let activeStream: AbortController | null = null;

export const cancelAccountsStream = (): void => {
  activeStream?.abort();
  activeStream = null;
};

const streamCategories = async (
  event: IpcMainInvokeEvent,
  only?: ServiceId,
  scope: MarketScope = 'purchased',
  streamId = 0,
): Promise<void> => {
  activeStream?.abort();
  const controller = new AbortController();
  activeStream = controller;
  const { signal } = controller;
  const startedAt = Date.now();

  const alive = () => activeStream === controller && !signal.aborted;
  let copies: ReadonlyMap<number, number> = new Map();
  const send = (payload: Omit<AccountsCategoryEvent, 'streamId'>) => {
    if (alive() && !event.sender.isDestroyed()) {
      event.sender.send(IPC_CHANNELS.ACCOUNTS_CATEGORY, {
        streamId,
        ...payload,
        items: stampCopies(payload.items, copies),
      });
    }
  };
  // When a single category is requested, stream only it and replace just its
  // slice of the cache. Otherwise stream the full fixed order for this scope.
  if (only !== undefined && !STREAM_ORDER.includes(only)) {
    const hint = 'Give it a `login` block in service-registry.ts to make it streamable.';
    log.warn(
      `[accounts] stream requested for non-streamable service "${only}" — falling back to a full re-stream. ${hint}`,
    );
  }
  const target = only !== undefined && STREAM_ORDER.includes(only) ? only : undefined;
  const order: readonly ServiceId[] = target ? [target] : STREAM_ORDER;
  const all: AccountSummary[] = [];
  const failed = new Set<ServiceId>();
  let unfiltered: AccountSummary[] | null = null;
  const getUnfiltered = async (): Promise<AccountSummary[]> => {
    if (unfiltered === null) unfiltered = (await listPurchasedAccounts(scope, signal)).items;
    return unfiltered;
  };
  const scopeOf = (it: AccountSummary): AccountScope => it.scope ?? 'purchased';

  const loadService = async (serviceId: ServiceId): Promise<void> => {
    if (!alive()) return;
    try {
      const categoryId = SERVICE_CATEGORY_ID[serviceId];
      if (categoryId === undefined) {
        const items = (await getUnfiltered()).filter((it) => it.category === serviceId);
        all.push(...items);
        if (items.length > 0) send({ serviceId, scope, items, categoryDone: false, done: false });
        send({ serviceId, scope, items: [], categoryDone: true, done: false });
        return;
      }
      const { complete } = await listAccountsByCategory(
        categoryId,
        scope,
        (pageItems, progress) => {
          all.push(...pageItems);
          send({
            serviceId,
            scope,
            items: pageItems,
            categoryDone: false,
            done: false,
            page: progress.page,
            totalPages: progress.totalPages,
          });
        },
        signal,
      );
      if (!complete && !signal.aborted) {
        log.warn(`[accounts] category ${serviceId} (${scope}) did not load in full`);
        failed.add(serviceId);
      }
    } catch (err) {
      if (signal.aborted) return; // a newer stream took over; don't mark done
      log.warn(`[accounts] category ${serviceId} failed`, err);
      failed.add(serviceId);
    }
    if (!alive()) return;
    send({
      serviceId,
      scope,
      items: [],
      categoryDone: true,
      done: false,
      failed: failed.has(serviceId),
    });
  };

  try {
    const settings = await getSettings();
    copies = indexCopies(await listLocalAccounts());
    const concurrency = Math.max(1, Math.min(4, settings.accountLoadConcurrency || 1));
    const queue = [...order];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (alive()) {
        const idx = next++;
        if (idx >= queue.length) return;
        const serviceId = queue[idx];
        if (serviceId) await loadService(serviceId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

    if (!alive()) return;
    const cached = (await loadCachedAccounts())?.items ?? [];
    if (!alive()) return; // a newer stream may have started during the await
    const fromFailed = (it: AccountSummary): boolean =>
      it.category !== null && failed.has(it.category);
    const fresh = all.filter((it) => !fromFailed(it));
    if (target) {
      if (failed.has(target)) {
        log.warn(`[accounts] ${target} (${scope}) failed — keeping the cached slice`);
      } else {
        const kept = cached.filter((it) => !(scopeOf(it) === scope && it.category === target));
        await saveCachedAccounts([...kept, ...fresh]);
      }
    } else {
      const kept = cached.filter((it) => scopeOf(it) !== scope || fromFailed(it));
      await saveCachedAccounts([...kept, ...fresh]);
    }
    const last = order[order.length - 1] as ServiceId;
    send({ serviceId: last, scope, items: [], categoryDone: true, done: true });
    const failedNote = failed.size > 0 ? `, ${failed.size} category failed` : '';
    recordAction({
      action: 'accounts.refresh',
      status: failed.size > 0 ? 'fail' : 'ok',
      durationMs: Date.now() - startedAt,
      target: target ?? scope,
      detail: `${fresh.length} accounts${failedNote}`,
    });
  } finally {
    if (activeStream === controller) {
      activeStream = null;
    }
  }
};

const toItemId = (payload?: { itemId?: unknown }): number => {
  const id = Number(payload?.itemId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('invalid itemId');
  return id;
};

const toTagId = (payload?: { tagId?: unknown }): number => {
  const id = Number(payload?.tagId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('invalid tagId');
  return id;
};

const previewOf = (details: AccountDetails): AccountPreview => ({
  itemId: details.itemId,
  category: details.category,
  categoryRaw: details.categoryRaw,
  categoryTitle: details.categoryTitle,
  title: details.title,
  description: details.description,
  price: details.price,
  currency: details.currency,
  imageUrl: details.imageUrl,
  tags: details.tags,
  warrantyEndsAt: details.warrantyEndsAt,
  publishedAt: details.publishedAt,
  purchasedAt: details.purchasedAt,
  isPurchased: details.isPurchased,
  scope: details.scope,
  steam: details.steam,
  telegram: details.telegram,
  discord: details.discord,
  instagram: details.instagram,
  tiktok: details.tiktok,
  llmService: details.llmService,
  llm: details.llm,
  hasEmailLogin: details.hasEmailLogin,
  hasMafile: details.hasMafile,
  note: details.note,
  folder: details.folder,
  marketItemId: details.marketItemId,
  localCopyId: details.localCopyId,
  owned: details.owned,
});

const getAccountPreview = async (itemId: number): Promise<AccountPreview | null> => {
  const details = await getAccountDetails(itemId);
  return details ? previewOf(details) : null;
};

const getMailCredentials = async (itemId: number): Promise<MailCredentials | null> => {
  const details = await getAccountDetails(itemId);
  return details ? mailboxFor(details) : null;
};

export const registerAccountsIpc = () => {
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_LIST, () => listAllAccounts());
  ipcMain.handle(
    IPC_CHANNELS.ACCOUNTS_LIST_STREAM,
    (event, payload?: { only?: ServiceId; scope?: MarketScope; streamId?: number }) =>
      streamCategories(event, payload?.only, payload?.scope ?? 'purchased', payload?.streamId ?? 0),
  );
  handleAction(IPC_CHANNELS.ACCOUNTS_REFRESH, () => fetchAndCache(), {
    action: 'accounts.refresh',
    detail: (items) => `${items.length} accounts`,
  });
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_CACHE_STATUS, () => cachedAccountsStatus());
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_CLEAR_CACHE, async () => {
    inflight = null;
    await clearCachedAccounts();
  });
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_GET_PREVIEW, (_e, payload?: { itemId: number }) =>
    getAccountPreview(toItemId(payload)),
  );
  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_GET_MAIL, (_e, payload?: { itemId: number }) =>
    getMailCredentials(toItemId(payload)),
  );
  handleAction(
    IPC_CHANNELS.ACCOUNT_CHECK,
    (_e, payload?: { itemId: number }) => checkAccountValidity(toItemId(payload)),
    {
      action: 'account.check',
      itemId: (p?: { itemId: number }) => p?.itemId ?? null,
      detail: (r) => (r.ok ? (r.valid ? 'valid' : (r.reason ?? 'invalid')) : null),
    },
  );
  handleAction(
    IPC_CHANNELS.ACCOUNT_ADD_TAG,
    (_e, payload?: { itemId: number; tagId: number }) =>
      addItemTag(toItemId(payload), toTagId(payload)),
    { action: 'account.tag.add', itemId: (p?: { itemId: number }) => p?.itemId ?? null },
  );
  handleAction(
    IPC_CHANNELS.ACCOUNT_REMOVE_TAG,
    (_e, payload?: { itemId: number; tagId: number }) =>
      removeItemTag(toItemId(payload), toTagId(payload)),
    { action: 'account.tag.remove', itemId: (p?: { itemId: number }) => p?.itemId ?? null },
  );
  handleAction(
    IPC_CHANNELS.ACCOUNT_SET_NOTE,
    async (_e, payload?: { itemId: number; text: string }) => {
      const itemId = toItemId(payload);
      const result = await setAccountNote(
        itemId,
        typeof payload?.text === 'string' ? payload.text : '',
      );
      if (result.ok) await patchCachedAccount(itemId, { note: result.note });
      return result;
    },
    {
      action: 'account.note',
      itemId: (p?: { itemId: number }) => p?.itemId ?? null,
      detail: (r) => (r.ok ? (r.note === null ? 'deleted' : 'saved') : null),
    },
  );

  onTokenChange(() => {
    inflight = null;
    cancelAccountsStream();
    void clearCachedAccounts();
  });
};

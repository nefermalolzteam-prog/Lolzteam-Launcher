import type {
  AccountScope,
  AccountSummary,
  AccountValidity,
  ServiceId,
  SupportedServiceId,
} from '@shared-types';
import {
  SUPPORTED_SERVICE_IDS,
  isLocalServiceId,
  isSupportedServiceId,
  serviceLabel,
} from '@shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { matchesLabelFilters } from '~/lib/labelFilter';
import {
  isScopeFailed,
  isScopeLoaded,
  mergeWithStream,
  useAccountsStream,
} from '~/stores/accountsStream';
import { useActiveFilters, useInventoryFilters } from '~/stores/inventoryFilters';
import { useSettings } from '~/stores/settings';
import { useCheckSources, validityOf } from './accountValidity';
import { attributesFor, matchesAttributes } from './attributes';
import { type SortKey, compareItems, matchesQuery, sortKeysFor } from './listRules';

// The list rules themselves live in `listRules.ts`.
export { sortKeysFor };
export type { SortDir, SortKey } from './listRules';

/** Services with a tab in the inventory. */
const SUPPORTED_SERVICES = SUPPORTED_SERVICE_IDS;
type SupportedService = SupportedServiceId;

export { SUPPORTED_SERVICES };

export const isSupportedService = (id: ServiceId | null): id is SupportedService =>
  isSupportedServiceId(id);

export interface Bucket {
  id: ServiceId | 'all';
  label: string;
  count: number;
  loading: boolean;
}

const buildBuckets = (
  items: AccountSummary[],
  allLabel: string,
  loaded: ReadonlySet<string>,
  scope: AccountScope,
  streaming: boolean,
): Bucket[] => {
  const counts = new Map<SupportedService, number>();
  for (const item of items) {
    if (isSupportedService(item.category)) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  // Local accounts are never streamed: their tabs are done the moment they show.
  const allDone =
    scope === 'local' || SUPPORTED_SERVICES.every((id) => loaded.has(`${scope}:${id}`));
  const buckets: Bucket[] = [
    { id: 'all', label: allLabel, count: total, loading: streaming && !allDone },
  ];
  // Only services whose login works offline can be stored locally.
  const services =
    scope === 'local' ? SUPPORTED_SERVICES.filter(isLocalServiceId) : SUPPORTED_SERVICES;
  for (const id of services) {
    buckets.push({
      id,
      label: serviceLabel(id),
      count: counts.get(id) ?? 0,
      loading: scope !== 'local' && !loaded.has(`${scope}:${id}`),
    });
  }
  return buckets;
};

const reportedHidden = new Set<string>();

const REGISTRY_HINT =
  'Register the service in packages/shared-types/src/service-registry.ts to show them.';

/** Logs each unsupported category once — the grid filter must never be silent. */
const reportHiddenAccounts = (counts: ReadonlyMap<string, number>): void => {
  for (const [category, count] of counts) {
    if (reportedHidden.has(category)) continue;
    reportedHidden.add(category);
    console.warn(
      `[inventory] ${count} account(s) of category "${category}" are hidden: no login adapter. ${REGISTRY_HINT}`,
    );
  }
};

/** Everything both the toolbar and the grid need: the account list, the scope split, and the per-category counts. */
export const useInventoryScope = (scopeOverride?: AccountScope) => {
  const { t } = useTranslation();
  const storedScope = useInventoryFilters((st) => st.scope);
  const scope = scopeOverride ?? storedScope;
  const streaming = useAccountsStream((st) => st.streaming);
  const loaded = useAccountsStream((st) => st.loaded);
  const failed = useAccountsStream((st) => st.failed);

  const query = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => mergeWithStream(await window.launcher.accounts.list()),
    staleTime: 60_000,
  });

  const rawItems = useMemo(() => query.data ?? [], [query.data]);
  const items = useMemo(() => rawItems.filter((it) => isSupportedService(it.category)), [rawItems]);

  // `rawScopedItems` keeps the unsupported categories so the "nothing purchased yet" screen stays honest.
  const rawScopedItems = useMemo(
    () => rawItems.filter((it) => (it.scope ?? 'purchased') === scope),
    [rawItems, scope],
  );
  const scopedItems = useMemo(
    () => items.filter((it) => (it.scope ?? 'purchased') === scope),
    [items, scope],
  );

  const scopeCounts = useMemo(() => {
    let purchased = 0;
    let listed = 0;
    let local = 0;
    for (const it of items) {
      const scopeOfItem = it.scope ?? 'purchased';
      if (scopeOfItem === 'listed') listed++;
      else if (scopeOfItem === 'local') local++;
      else purchased++;
    }
    return { purchased, listed, local };
  }, [items]);

  const buckets = useMemo(
    () => buildBuckets(scopedItems, t('inventory.filter.all'), loaded, scope, streaming),
    [scopedItems, t, loaded, scope, streaming],
  );

  return {
    query,
    rawItems,
    items,
    rawScopedItems,
    scopedItems,
    scopeCounts,
    buckets,
    scope,
    streaming,
    loaded,
    allDone: isScopeLoaded(loaded, scope),
    /** The market was asked and did not answer — for at least one category of this scope, or for the list request itself. */
    failed: isScopeFailed(failed, scope) || query.isError,
  };
};

/** The scope data plus the filtered, sorted list the grid renders. */
export const useInventoryList = (scopeOverride?: AccountScope) => {
  const base = useInventoryScope(scopeOverride);
  const { scopedItems, rawItems, scope, streaming, loaded, query } = base;
  const failedKeys = useAccountsStream((st) => st.failed);

  const filter = useInventoryFilters((st) => st.filter);
  const llmService = useInventoryFilters((st) => st.llmService);
  const search = useInventoryFilters((st) => st.search);
  // One subscription for all five: they belong to the open tab and change together.
  const { includeLabels, excludeLabels, attrs, validity, folder } = useActiveFilters();
  const settings = useSettings((st) => st.settings);
  const hideInvalid = settings?.inventoryHideInvalid ?? false;
  const storedSortKey = settings?.inventorySortKey ?? 'purchased';
  const sortDir = settings?.inventorySortDir ?? 'desc';
  // One setting serves both scopes, and «цена» means nothing in the local base.
  const sortKey: SortKey = sortKeysFor(scope).includes(storedSortKey) ? storedSortKey : 'purchased';

  // What the checks know, for the verdict, the «last checked» order and the search.
  const sources = useCheckSources();

  // Accounts the launcher cannot show yet (category unknown, or known but without a login adapter).
  const hiddenByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of rawItems) {
      if (isSupportedService(it.category)) continue;
      const key = it.category ?? it.categoryTitle ?? it.categoryRaw ?? 'unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [rawItems]);
  const hiddenCount = useMemo(
    () => [...hiddenByCategory.values()].reduce((a, b) => a + b, 0),
    [hiddenByCategory],
  );
  useEffect(() => {
    if (hiddenCount > 0) reportHiddenAccounts(hiddenByCategory);
  }, [hiddenCount, hiddenByCategory]);

  const trimmedSearch = search.trim();

  // A chip only narrows the grid on the tab that offers it.
  const offered = useMemo(() => new Set(attributesFor(filter).map((a) => a.id)), [filter]);
  const activeAttrs = useMemo(() => attrs.filter((id) => offered.has(id)), [attrs, offered]);

  /** Which verdicts are shown. */
  const wantValidity: readonly AccountValidity[] | null = useMemo(() => {
    if (validity.length > 0) return validity;
    return hideInvalid ? (['valid', 'unknown'] as const) : null;
  }, [validity, hideInvalid]);

  // Folders only exist in the local base; a selection made there must not keep emptying the grid after a switch.
  const activeFolder = scope === 'local' ? folder : null;

  const visible = useMemo(() => {
    const filtered = scopedItems.filter(
      (it) =>
        (filter === 'all' || it.category === filter) &&
        (filter !== 'llm' || llmService === 'all' || it.llmService === llmService) &&
        (activeFolder === null || (it.folder ?? '') === activeFolder) &&
        (wantValidity === null || wantValidity.includes(validityOf(it, sources))) &&
        matchesLabelFilters(
          it.tags.map((tg) => tg.id),
          includeLabels,
          excludeLabels,
        ) &&
        matchesAttributes(it, activeAttrs, sources) &&
        matchesQuery(it, trimmedSearch, sources),
    );
    return [...filtered].sort((a, b) => compareItems(a, b, sortKey, sortDir, sources));
  }, [
    scopedItems,
    filter,
    llmService,
    activeFolder,
    wantValidity,
    includeLabels,
    excludeLabels,
    activeAttrs,
    trimmedSearch,
    sortKey,
    sortDir,
    sources,
  ]);

  const activeLoading =
    scope !== 'local' &&
    (filter === 'all'
      ? streaming && !base.allDone
      : isSupportedService(filter) && !loaded.has(`${scope}:${filter}`));

  /** The tab the user is actually looking at came back empty because it failed. */
  const filterFailed =
    scope !== 'local' &&
    (filter === 'all'
      ? base.failed
      : isSupportedService(filter) && failedKeys.has(`${scope}:${filter}`));

  // Everything that narrows the list, as one value.
  const filtersKey = [
    scope,
    filter,
    llmService,
    hideInvalid,
    validity.join(),
    activeFolder ?? '*',
    sortKey,
    sortDir,
    trimmedSearch,
    includeLabels.join(),
    excludeLabels.join(),
    activeAttrs.join(),
  ].join('|');

  return {
    ...base,
    filter,
    sortKey,
    visible,
    filtersKey,
    hiddenByCategory,
    hiddenCount,
    activeLoading,
    filterFailed,
    fullySettled: !streaming && !query.isLoading && !query.isFetching,
  };
};

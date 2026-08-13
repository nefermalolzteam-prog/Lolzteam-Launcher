import type { AccountScope, AccountSummary, LocalAccountInput } from '@shared-types';
import { isServiceId, serviceLabel } from '@shared-types';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Inbox,
  Minus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MassBar } from '~/features/base/MassBar';
import { useFadedSwap } from '~/lib/useFadedSwap';
import { isScopeLoaded, startAccountsStream, useAccountsStream } from '~/stores/accountsStream';
import { useInventoryFilters } from '~/stores/inventoryFilters';
import { useInventoryReveal } from '~/stores/inventoryReveal';
import { useInventorySelection } from '~/stores/inventorySelection';
import { useLocalEditor } from '~/stores/localEditor';
import { useLocalLabels } from '~/stores/localLabels';
import { useProfileLabels } from '~/stores/profileLabels';
import { useSettings } from '~/stores/settings';
import { useTelegramTasks } from '~/stores/telegramTasks';
import { useView } from '~/stores/view';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalHint, ModalSpacer } from '~/widgets/Modal/ModalKit';
import { useScrollRoot } from '~/widgets/Shell/scrollRoot';
import { InventoryGrid } from './InventoryGrid';
import { SkeletonCard, SkeletonRow } from './InventorySkeleton';
import s from './InventoryView.module.scss';
import { LocalAccountModal } from './LocalAccountModal';
import { isCheckable } from './checkable';
import { localErrorText } from './localErrors';
import { SUPPORTED_SERVICES, type SortDir, type SortKey, useInventoryList } from './useInventory';

const SKELETON_INITIAL = 8;
const SKELETON_TAIL = 4;

/** Where a user's purchases actually live. */
const ordersUrlFor = (userId: number | null): string =>
  userId ? `https://lzt.market/user/${userId}/orders` : 'https://lzt.market/';

/** Which scopes narrow the table, and to what. */
const SCOPE_TRACK_CLASS: Partial<Record<AccountScope, string>> = {
  local: s.tableLocal,
  listed: s.tableListed,
};

/** The account grid. */
export const InventoryView = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const loadLabels = useProfileLabels((p) => p.load);
  const labels = useProfileLabels((p) => p.labels);
  const labelsLoaded = useProfileLabels((p) => p.loaded);
  // Load the label palette once so card chips can render in their colours.
  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  const keepLabels = useInventoryFilters((st) => st.keepLabels);
  const localLabels = useLocalLabels((st) => st.labels);
  const loadLocalLabels = useLocalLabels((st) => st.load);
  const localLabelsLoaded = useLocalLabels((st) => st.loaded);
  // The user's own labels ride in the same `tags` array as the forum's.
  useEffect(() => {
    void loadLocalLabels();
  }, [loadLocalLabels]);

  // Labels may disappear from the palette.
  useEffect(() => {
    if (!localLabelsLoaded || !labelsLoaded) return;
    keepLabels(new Set([...labels.map((l) => l.id), ...localLabels.map((l) => l.id)]));
  }, [labels, labelsLoaded, localLabels, localLabelsLoaded, keepLabels]);

  // --- What is on screen ----------------------------------------------------- Two controls replace the whole list.
  const trackRef = useRef<HTMLDivElement>(null);
  const layout = useSettings((st) => st.settings?.inventoryLayout ?? 'grid');
  const liveScope = useInventoryFilters((st) => st.scope);
  const frame = useMemo(
    () => ({ table: layout === 'table', scope: liveScope }),
    [layout, liveScope],
  );
  const shown = useFadedSwap(frame, trackRef);
  const table = shown.table;

  const {
    query,
    rawItems,
    rawScopedItems,
    scopedItems,
    visible,
    filter,
    filtersKey,
    scope,
    sortKey,
    streaming,
    loaded,
    allDone,
    activeLoading,
    fullySettled,
    failed,
    filterFailed,
    hiddenByCategory,
    hiddenCount,
  } = useInventoryList(shown.scope);

  // The «Открыть lzt.market» button used to point at `/orders`.
  const authStatus = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => window.launcher.auth.getStatus(),
  });
  const ordersUrl = ordersUrlFor(authStatus.data?.session?.userId ?? null);
  const openOrders = () => void window.launcher.app.openExternal(ordersUrl);

  /** Ask the market again, from an empty screen. */
  const reload = () => {
    if (streaming || scope === 'local') return;
    startAccountsStream(undefined, scope);
    void qc.invalidateQueries({ queryKey: ['auth-status'] });
  };

  const launchHandled = useAccountsStream((st) => st.launchHandled);
  const sortDir = useSettings((st) => st.settings?.inventorySortDir ?? 'desc');
  const applySettings = useSettings((st) => st.set);
  const scrollRoot = useScrollRoot();

  const openLocalEditor = useLocalEditor((st) => st.openEdit);
  const setView = useView((st) => st.setView);
  const openLocalCreate = () => setView('localAdd');
  const editorOpen = useLocalEditor((st) => st.open);
  const editorTarget = useLocalEditor((st) => st.target);
  const closeLocalEditor = useLocalEditor((st) => st.close);

  useEffect(() => {
    useAccountsStream.getState().setActiveScope(scope);
    // Local accounts come from disk with the initial list — nothing to stream.
    if (!launchHandled || scope === 'local') return;
    if (!isScopeLoaded(loaded, scope) && !streaming) startAccountsStream(undefined, scope);
  }, [scope, loaded, streaming, launchHandled]);

  // A change to any filter input means a different list — start it from the top
  // rather than leaving the user at a scroll offset that meant something else.
  //
  // Unless the list is being taken to a particular account: `revealAccount` gets
  // there by changing exactly these inputs (the scope, the search, the category
  // filters), so this effect would fire on every reveal and undo it. And it
  // would win — React runs a child's effects before the parent's, so the grid
  // has already scrolled by the time this one runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `filtersKey` is exactly the set of filter inputs — scroll back up whenever any of them changes
  useEffect(() => {
    if (useInventoryReveal.getState().itemId !== null) return;
    scrollRoot?.scrollTo({ top: 0 });
  }, [filtersKey, scrollRoot]);

  // --- Table mode ------------------------------------------------------------ The column template is published.
  const trackClass = table ? `${s.table} ${SCOPE_TRACK_CLASS[scope] ?? ''}` : '';
  // Only the "nothing has arrived yet" placeholders use a plain CSS grid.
  const placeholderClass = `${s.placeholders} ${table ? s.placeholdersTable : ''}`;

  const sortByColumn = (key: SortKey) => {
    // The same caption again flips the direction; a new one starts at the end worth seeing first — newest, dearest.
    const fresh: SortDir = key === 'title' ? 'asc' : 'desc';
    const dir: SortDir = sortKey === key ? (sortDir === 'asc' ? 'desc' : 'asc') : fresh;
    void window.launcher.settings
      .set({ inventorySortKey: key, inventorySortDir: dir })
      .then((next) => applySettings(next.settings));
  };

  const sortCaption = (key: SortKey, text: string) => (
    <button
      type="button"
      className={`${s.headSort} ${sortKey === key ? s.headSortOn : ''}`}
      onClick={() => sortByColumn(key)}
    >
      <span>{text}</span>
      {sortKey === key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );

  const skeletons = (count: number, prefix: string) =>
    Array.from({ length: count }, (_, i) =>
      table ? <SkeletonRow key={`${prefix}${i}`} /> : <SkeletonCard key={`${prefix}${i}`} />,
    );

  // --- Mass operations ------------------------------------------------------- A card gets a checkbox when some action can.
  const selectedIds = useInventorySelection((st) => st.ids);
  const toggleSelected = useInventorySelection((st) => st.toggle);
  const replaceSelected = useInventorySelection((st) => st.replace);
  const candidates = useMemo(() => visible.filter(isCheckable), [visible]);
  const candidateIds = useMemo(() => new Set(candidates.map((it) => it.itemId)), [candidates]);
  const selectionOn = candidates.length > 0;
  // The caption cell doubles as the master checkbox — same rule as the bar at the bottom.
  const chosenCount = useMemo(
    () => candidates.reduce((n, it) => (selectedIds.has(it.itemId) ? n + 1 : n), 0),
    [candidates, selectedIds],
  );
  const allSelected = candidates.length > 0 && chosenCount === candidates.length;
  const someSelected = chosenCount > 0 && !allSelected;
  const toggleAllVisible = (): void => {
    if (allSelected) {
      const next = new Set(selectedIds);
      for (const it of candidates) next.delete(it.itemId);
      replaceSelected(next);
    } else {
      replaceSelected([...selectedIds, ...candidates.map((it) => it.itemId)]);
    }
  };
  // A run outlives the selection it started from.
  const running = useTelegramTasks((st) => st.running);

  // --- Local accounts: add / edit / delete ----------------------------------- No store of their own beyond which form is.
  const [deleteTarget, setDeleteTarget] = useState<AccountSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The three callbacks every card gets.
  const handleSelect = useCallback(
    (item: AccountSummary) => toggleSelected(item.itemId),
    [toggleSelected],
  );
  const handleEdit = useCallback(
    (item: AccountSummary) => void openLocalEditor(item.itemId),
    [openLocalEditor],
  );
  const handleDelete = useCallback((item: AccountSummary) => {
    setDeleteError(null);
    setDeleteTarget(item);
  }, []);

  const submitLocal = async (input: LocalAccountInput) => {
    const res = editorTarget
      ? await window.launcher.localAccounts.update(editorTarget.id, input)
      : await window.launcher.localAccounts.create(input);
    if (res.ok) await qc.invalidateQueries({ queryKey: ['accounts'] });
    return res.ok ? { ok: true } : { ok: false, message: res.message };
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await window.launcher.localAccounts.remove(deleteTarget.itemId);
    if (res.ok) {
      await qc.invalidateQueries({ queryKey: ['accounts'] });
      setDeleteTarget(null);
    } else {
      setDeleteError(localErrorText(t, res.message));
    }
    setDeleting(false);
  };

  // Hard error with nothing cached to fall back on.
  if (query.isError && rawItems.length === 0) {
    return (
      <div ref={trackRef} className={s.state}>
        <div className={`${s.stateBadge} ${s.stateBadgeDanger}`}>
          <AlertCircle size={26} />
        </div>
        <p className={s.stateText}>{t('inventory.error')}</p>
        <button type="button" className={s.retry} onClick={() => query.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  /** Nothing arrived, and the reason is that nothing was successfully asked. */
  if (scope !== 'local' && rawScopedItems.length === 0 && fullySettled && failed) {
    return (
      <div ref={trackRef} className={s.state}>
        <div className={`${s.stateBadge} ${s.stateBadgeDanger}`}>
          <AlertCircle size={26} />
        </div>
        <p className={s.stateText}>{t('inventory.loadFailed')}</p>
        <div className={s.stateActions}>
          <button type="button" className={s.retry} disabled={streaming} onClick={reload}>
            <RefreshCw size={15} className={streaming ? s.spin : undefined} />
            <span>{t('inventory.refresh')}</span>
          </button>
          <button type="button" className={s.retrySecondary} onClick={openOrders}>
            {t('inventory.openMarket')}
          </button>
        </div>
      </div>
    );
  }

  if (scope === 'purchased' && rawScopedItems.length === 0 && fullySettled) {
    return (
      <div ref={trackRef} className={s.state}>
        <div className={s.stateBadge}>
          <Inbox size={26} />
        </div>
        <p className={s.stateText}>{t('inventory.empty')}</p>
        <div className={s.stateActions}>
          <button type="button" className={s.retry} disabled={streaming} onClick={reload}>
            <RefreshCw size={15} className={streaming ? s.spin : undefined} />
            <span>{t('inventory.refresh')}</span>
          </button>
          <button type="button" className={s.retrySecondary} onClick={openOrders}>
            {t('inventory.openMarket')}
          </button>
        </div>
      </div>
    );
  }

  if (scope === 'purchased' && scopedItems.length === 0 && fullySettled) {
    return (
      <div ref={trackRef} className={s.state}>
        <div className={s.stateBadge}>
          <Inbox size={26} />
        </div>
        <p className={s.stateText}>
          {t('inventory.emptyUnsupported', {
            services: SUPPORTED_SERVICES.map((id) => serviceLabel(id)).join(', '),
          })}
        </p>
        <div className={s.stateActions}>
          <button type="button" className={s.retry} disabled={streaming} onClick={reload}>
            <RefreshCw size={15} className={streaming ? s.spin : undefined} />
            <span>{t('inventory.refresh')}</span>
          </button>
          <button type="button" className={s.retrySecondary} onClick={openOrders}>
            {t('inventory.openMarket')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.view}>
      {hiddenCount > 0 && (
        <div className={s.hiddenNotice} role="status">
          <AlertCircle size={14} />
          <span>
            {t('inventory.hiddenAccounts', {
              count: hiddenCount,
              categories: [...hiddenByCategory.keys()]
                .map((id) => (isServiceId(id) ? serviceLabel(id) : id))
                .join(', '),
            })}
          </span>
        </div>
      )}

      {visible.length === 0 && (activeLoading || !allDone) ? (
        <div ref={trackRef} className={trackClass}>
          <div className={placeholderClass}>{skeletons(SKELETON_INITIAL, 'init-')}</div>
        </div>
      ) : visible.length === 0 ? (
        <div ref={trackRef} className={s.noResults}>
          <div className={`${s.stateBadge} ${filterFailed ? s.stateBadgeDanger : ''}`}>
            {filterFailed ? <AlertCircle size={24} /> : <Search size={24} />}
          </div>
          {filterFailed ? (
            <>
              <p className={s.stateText}>{t('inventory.loadFailed')}</p>
              <button type="button" className={s.retry} disabled={streaming} onClick={reload}>
                <RefreshCw size={15} className={streaming ? s.spin : undefined} />
                <span>{t('inventory.refresh')}</span>
              </button>
            </>
          ) : scope === 'listed' && scopedItems.length === 0 ? (
            <>
              <p className={s.stateText}>{t('inventory.scope.emptyListed')}</p>
              <button
                type="button"
                className={s.retry}
                onClick={() => window.launcher.app.openExternal('https://lzt.market/user/items')}
              >
                {t('inventory.scope.manageListings')}
              </button>
            </>
          ) : scope === 'local' && scopedItems.length === 0 ? (
            <>
              <p className={s.stateText}>{t('inventory.local.empty')}</p>
              <button type="button" className={s.retry} onClick={openLocalCreate}>
                {t('inventory.local.add')}
              </button>
            </>
          ) : (
            <p className={s.stateText}>{t('inventory.noResults')}</p>
          )}
        </div>
      ) : (
        <div ref={trackRef} className={trackClass}>
          {table && (
            <div className={s.tableHead}>
              <span className={`${s.headCell} ${s.headCellSelect}`}>
                {selectionOn ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
                    aria-label={t('base.selectAll')}
                    title={t('base.selectAll')}
                    className={`${s.headCheck} ${allSelected || someSelected ? s.headCheckOn : ''}`}
                    onClick={toggleAllVisible}
                  >
                    {allSelected ? (
                      <Check size={12} strokeWidth={3} />
                    ) : (
                      someSelected && <Minus size={12} strokeWidth={3} />
                    )}
                  </button>
                ) : (
                  '#'
                )}
              </span>
              <span className={s.headCell}>
                {sortCaption('title', t('inventory.table.account'))}
              </span>
              <span className={s.headCell}>{t('inventory.table.status')}</span>
              {/* Одна колонка на метки и на то, что приложение знает об аккаунте: это одна строка фишек. */}
              <span className={s.headCell}>{t('inventory.table.labelsInfo')}</span>
              <span className={`${s.headCell} ${s.headCellPurchased}`}>
                {sortCaption(
                  'purchased',
                  t(
                    scope === 'local'
                      ? 'inventory.card.addedLabel'
                      : 'inventory.card.purchasedLabel',
                  ),
                )}
              </span>
              <span className={`${s.headCell} ${s.headCellMarket} ${s.headCellRight}`}>
                {sortCaption('price', t('inventory.card.priceLabel'))}
              </span>
              <span className={`${s.headCell} ${s.headCellRight}`}>
                {t('inventory.table.actions')}
              </span>
            </div>
          )}
          <InventoryGrid
            // A different scope is a different list, not the same one filtered: remounting drops the measured row heights with it.
            key={`${scope}:${filter}`}
            items={visible}
            table={table}
            selectionOn={selectionOn}
            candidateIds={candidateIds}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onEdit={handleEdit}
            onDelete={handleDelete}
            pending={activeLoading ? SKELETON_TAIL : 0}
          />
        </div>
      )}

      {(chosenCount > 0 || running) && <MassBar candidates={candidates} />}

      {editorOpen && (
        <LocalAccountModal edit={editorTarget} onClose={closeLocalEditor} onSubmit={submitLocal} />
      )}

      {deleteTarget && (
        <Modal
          title={t('inventory.local.deleteTitle')}
          subtitle={deleteTarget.title}
          size="sm"
          closable={!deleting}
          onClose={deleting ? undefined : () => setDeleteTarget(null)}
          footer={
            <>
              <ModalSpacer />
              <Button
                variant="ghost"
                size="sm"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                {t('inventory.local.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                busy={deleting}
                onClick={() => void confirmDelete()}
              >
                {t('inventory.local.deleteConfirm')}
              </Button>
            </>
          }
        >
          <ModalHint>{t('inventory.local.deleteBody', { title: deleteTarget.title })}</ModalHint>
          <ModalError>{deleteError}</ModalError>
        </Modal>
      )}
    </div>
  );
};

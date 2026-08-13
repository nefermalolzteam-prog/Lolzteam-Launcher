import type { InventoryLayout } from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { Fragment, type JSX, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConverterModal } from '~/features/base/ConverterModal';
import { serviceLogo } from '~/lib/serviceLogos';
import { isStreamService, startAccountsStream } from '~/stores/accountsStream';
import { useInventoryFilters } from '~/stores/inventoryFilters';
import { useLocalEditor } from '~/stores/localEditor';
import { useSettings } from '~/stores/settings';
import { useView } from '~/stores/view';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { DesignColumnsIcon, DesignRowsIcon } from './DesignIcons';
import { FiltersModal, useFiltersCount, useResetFilters } from './FiltersModal';
import s from './InventoryToolbar.module.scss';
import { LlmServiceFilter } from './LlmServiceFilter';
import { SCOPE_ICON } from './ScopeIcons';
import {
  AllCategoriesIcon,
  ConverterIcon,
  FilterIcon,
  RefreshIcon,
  SearchClearIcon,
  SearchIcon,
} from './ToolbarIcons';
import { useInventoryScope } from './useInventory';

const SCOPES = ['purchased', 'listed', 'local'] as const;

const LAYOUTS = [
  { id: 'table', Icon: DesignRowsIcon },
  { id: 'grid', Icon: DesignColumnsIcon },
] as const satisfies readonly { id: InventoryLayout; Icon: () => JSX.Element }[];

export const InventoryToolbar = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [converterOpen, setConverterOpen] = useState(false);

  const { buckets, scopeCounts, scope, streaming } = useInventoryScope();
  const filter = useInventoryFilters((st) => st.filter);
  const llmService = useInventoryFilters((st) => st.llmService);
  const search = useInventoryFilters((st) => st.search);
  const setScope = useInventoryFilters((st) => st.setScope);
  const setFilter = useInventoryFilters((st) => st.setFilter);
  const setLlmService = useInventoryFilters((st) => st.setLlmService);
  const setSearch = useInventoryFilters((st) => st.setSearch);
  const openCreate = () => useView.getState().setView('localAdd');
  const editorLoading = useLocalEditor((st) => st.loading);
  const filtersCount = useFiltersCount();
  const resetFilters = useResetFilters();

  // The converter turns Telegram session files into accounts on disk — it has nothing to say about a bought account.
  const showConverter = scope === 'local' && filter === 'telegram';

  // The toolbar stays mounted on every view (the header collapses rather than unmounts).
  const view = useView((st) => st.view);
  useEffect(() => {
    if (view === 'inventory') return;
    setFiltersOpen(false);
    setConverterOpen(false);
  }, [view]);

  // Persisted so the chosen layout survives a restart, like the sort order.
  const layout = useSettings((st) => st.settings?.inventoryLayout ?? 'grid');
  const setSettings = useSettings((st) => st.set);
  const setLayout = (next: InventoryLayout) => {
    if (next === layout) return;
    void window.launcher.settings
      .set({ inventoryLayout: next })
      .then((res) => setSettings(res.settings));
  };

  const refresh = () => {
    if (streaming || scope === 'local') return;
    const only = filter !== 'all' && isStreamService(filter) ? filter : undefined;
    // The one stream the user pressed a button.
    startAccountsStream(only, scope, { announce: true });
    void qc.invalidateQueries({ queryKey: ['auth-status'] });
  };

  return (
    <>
      <div className={s.toolbar}>
        <div className={s.scopeTabs} role="tablist" aria-label={t('inventory.scope.label')}>
          {SCOPES.map((sc) => {
            const Icon = SCOPE_ICON[sc];
            return (
              <button
                key={sc}
                type="button"
                role="tab"
                aria-selected={scope === sc}
                className={`${s.scopeTab} ${scope === sc ? s.scopeTabActive : ''}`}
                onClick={() => setScope(sc)}
              >
                <Icon />
                <span>{t(`inventory.scope.${sc}`)}</span>
                <span className={s.filterCount}>{scopeCounts[sc]}</span>
              </button>
            );
          })}
        </div>
        <div className={s.controlsActions}>
          <div className={s.leftControls}>
            <div className={s.designChanger}>
              {LAYOUTS.map(({ id, Icon }) => (
                // The bubble, not the native `title`: the two would otherwise both appear, one under the other, saying the same thing.
                <Tooltip key={id} label={t(`inventory.layout.${id}`)} placement="bottom">
                  <button
                    type="button"
                    className={`${s.designChangerItem} ${layout === id ? s.designChangerItemActive : ''}`}
                    aria-pressed={layout === id}
                    aria-label={t(`inventory.layout.${id}`)}
                    onClick={() => setLayout(id)}
                  >
                    <Icon />
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className={s.filterGroup}>
              <button
                type="button"
                className={`${s.filterBtn} ${filtersCount > 0 ? s.filterBtnActive : ''}`}
                onClick={() => setFiltersOpen(true)}
                aria-haspopup="dialog"
              >
                <FilterIcon />
                <span>{t('inventory.filters.title')}</span>
                {/* The count replaces the dot that used to sit here. */}
                {filtersCount > 0 && <span className={s.filterCount}>{filtersCount}</span>}
              </button>
              {/* A button of its own rather than a cross inside the one above. */}
              {filtersCount > 0 && (
                <Tooltip label={t('inventory.filters.reset')} placement="bottom">
                  <button
                    type="button"
                    className={s.filterClear}
                    onClick={resetFilters}
                    aria-label={t('inventory.filters.reset')}
                  >
                    <X size={15} />
                  </button>
                </Tooltip>
              )}
            </div>
            {filter === 'llm' && <LlmServiceFilter value={llmService} onChange={setLlmService} />}
            {showConverter && (
              <button
                type="button"
                className={s.filterBtn}
                onClick={() => setConverterOpen(true)}
                aria-haspopup="dialog"
              >
                <ConverterIcon />
                <span>{t('base.converter.title')}</span>
              </button>
            )}
            {/* «Добавить аккаунт» belongs to the left cluster: it acts on the list the controls next to it describe. */}
            {scope === 'local' && (
              <button
                type="button"
                className={s.addBtn}
                onClick={openCreate}
                disabled={editorLoading}
              >
                {editorLoading ? <Loader2 size={15} className={s.spin} /> : <Plus size={15} />}
                <span>{t('inventory.local.add')}</span>
              </button>
            )}
          </div>
          {scope !== 'local' && (
            <button type="button" className={s.refresh} onClick={refresh} disabled={streaming}>
              <RefreshIcon className={streaming ? s.spin : ''} />
            </button>
          )}
        </div>
      </div>

      <div className={s.controls}>
        <div className={s.searchBox}>
          <SearchIcon className={s.searchIcon} />
          <input
            type="text"
            className={s.searchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inventory.searchPlaceholder')}
          />
          {search && (
            <button
              type="button"
              className={s.searchClear}
              onClick={() => setSearch('')}
              aria-label={t('inventory.searchClear')}
            >
              <SearchClearIcon />
            </button>
          )}
        </div>

        <div className={s.filters}>
          {buckets.map((b, i) => {
            const logo = b.id === 'all' ? undefined : serviceLogo(b.id);
            return (
              <Fragment key={b.id}>
                {i > 0 && <span className={s.filterDivider} aria-hidden />}
                {/* The app's bubble rather than the native `title`: the button is a bare logo. */}
                <Tooltip label={b.label} placement="bottom">
                  <button
                    type="button"
                    className={`${s.filter} ${filter === b.id ? s.filterActive : ''}`}
                    onClick={() => setFilter(b.id)}
                    aria-label={b.label}
                  >
                    {b.id === 'all' ? (
                      <AllCategoriesIcon className={s.filterLogo} />
                    ) : logo ? (
                      <img className={s.filterLogo} src={logo} alt="" />
                    ) : (
                      <span>{b.label}</span>
                    )}
                    {b.loading ? (
                      <span className={s.filterCountSkeleton} aria-hidden />
                    ) : (
                      <span className={s.filterCount}>{b.count}</span>
                    )}
                  </button>
                </Tooltip>
              </Fragment>
            );
          })}
        </div>
      </div>

      {filtersOpen && <FiltersModal onClose={() => setFiltersOpen(false)} />}
      {converterOpen && <ConverterModal onClose={() => setConverterOpen(false)} />}
    </>
  );
};

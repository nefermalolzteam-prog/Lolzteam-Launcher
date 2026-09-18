import type { AccountValidity } from '@shared-types';
import { serviceLabel } from '@shared-types';
import { ArrowDownUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveFilters, useInventoryFilters } from '~/stores/inventoryFilters';
import { useLocalGroups } from '~/stores/localGroups';
import { useLocalLabels } from '~/stores/localLabels';
import { useProfileLabels } from '~/stores/profileLabels';
import { patchSettings, useSettings } from '~/stores/settings';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalCheck,
  ModalChecks,
  ModalChip,
  ModalChips,
  ModalGroup,
  ModalInput,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';
import s from './FiltersModal.module.scss';
import { type LabelChoice, LabelMultiSelect } from './LabelMultiSelect';
import { attributesFor } from './attributes';
import { type SortDir, type SortKey, sortKeysFor } from './useInventory';

/** The three verdicts, in the order the card's own badge would rank them. */
const VALIDITY_ORDER: readonly AccountValidity[] = ['valid', 'unknown', 'invalid'] as const;

/** The settings this dialog owns, back at their defaults. */
const SETTINGS_DEFAULTS = {
  inventoryHideInvalid: false,
  inventorySortKey: 'purchased',
  inventorySortDir: 'desc',
} as const;

/** How many of this dialog's answers differ from the defaults — the number the toolbar prints on its trigger. */
export const useFiltersCount = (): number => {
  const settings = useSettings((st) => st.settings);
  const { includeLabels, excludeLabels, attrs, validity, folder, priceMin, priceMax } =
    useActiveFilters();
  const scope = useInventoryFilters((st) => st.scope);
  const filter = useInventoryFilters((st) => st.filter);

  const offered = useMemo(() => new Set(attributesFor(filter).map((a) => a.id)), [filter]);
  const hideInvalid = settings?.inventoryHideInvalid ?? false;
  const sortKeys = sortKeysFor(scope);
  const storedSortKey = settings?.inventorySortKey ?? 'purchased';
  const sortKey = sortKeys.includes(storedSortKey) ? storedSortKey : 'purchased';
  const sortDir = settings?.inventorySortDir ?? 'desc';

  return (
    includeLabels.length +
    excludeLabels.length +
    attrs.filter((id) => offered.has(id)).length +
    validity.length +
    (scope === 'local' && folder !== null ? 1 : 0) +
    (scope !== 'local' && priceMin !== null ? 1 : 0) +
    (scope !== 'local' && priceMax !== null ? 1 : 0) +
    (hideInvalid && validity.length === 0 ? 1 : 0) +
    (sortKey !== 'purchased' || sortDir !== 'desc' ? 1 : 0)
  );
};

/** True when anything in this dialog differs from the defaults. */
export const useFiltersActive = (): boolean => useFiltersCount() > 0;

/** Puts this dialog back to its defaults: the open tab's filters go, every other tab keeps its own. */
export const useResetFilters = (): (() => void) => {
  const resetCategory = useInventoryFilters((st) => st.resetCategory);
  return useCallback(() => {
    resetCategory();
    void patchSettings(SETTINGS_DEFAULTS);
  }, [resetCategory]);
};

/** `''` clears the bound; anything unparsable is thrown away rather than guessed at. */
const parseBound = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) && value >= 0 ? value : null;
};

interface FiltersModalProps {
  onClose: () => void;
}

/** Sort order, verdict and quality chips, the price window, the folder of the local base. */
export const FiltersModal = ({ onClose }: FiltersModalProps) => {
  const { t } = useTranslation();
  const forumLabels = useProfileLabels((p) => p.labels);
  const localLabels = useLocalLabels((st) => st.labels);
  const loadLocalLabels = useLocalLabels((st) => st.load);
  const settings = useSettings((st) => st.settings);
  const { includeLabels, excludeLabels, attrs, validity, folder, priceMin, priceMax } =
    useActiveFilters();
  const toggleInclude = useInventoryFilters((st) => st.toggleInclude);
  const toggleExclude = useInventoryFilters((st) => st.toggleExclude);
  const scope = useInventoryFilters((st) => st.scope);
  const filter = useInventoryFilters((st) => st.filter);
  const toggleAttr = useInventoryFilters((st) => st.toggleAttr);
  const toggleValidity = useInventoryFilters((st) => st.toggleValidity);
  const setFolder = useInventoryFilters((st) => st.setFolder);
  const setPriceRange = useInventoryFilters((st) => st.setPriceRange);
  const groups = useLocalGroups((st) => st.groups);
  const loadGroups = useLocalGroups((st) => st.load);
  const resetFilters = useResetFilters();
  const filtersActive = useFiltersActive();

  const local = scope === 'local';

  useEffect(() => {
    void loadLocalLabels();
    if (local) void loadGroups();
  }, [loadLocalLabels, loadGroups, local]);

  // The chip set follows the open category tab, so a Telegram-only question never shows up above a grid of Steam accounts.
  const chips = attributesFor(filter);

  /** Both palettes as one list. */
  const labels = useMemo<LabelChoice[]>(
    () => [...localLabels.map((l) => ({ id: l.id, title: l.title, bc: l.bc })), ...forumLabels],
    [localLabels, forumLabels],
  );

  /** Folders on offer: the root, every folder main found, and the one already chosen. */
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const service of ['telegram', 'steam'] as const) {
      // On a category tab only that service's folders are reachable; on «Все» an account of either service may be in view.
      if (filter !== 'all' && filter !== service) continue;
      for (const name of groups[service] ?? []) set.add(name);
    }
    if (folder) set.add(folder);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [groups, filter, folder]);

  const hideInvalid = settings?.inventoryHideInvalid ?? false;
  const storedSortKey = settings?.inventorySortKey ?? 'purchased';
  const sortDir = settings?.inventorySortDir ?? 'desc';
  const sortKeys = sortKeysFor(scope);
  const sortKey: SortKey = sortKeys.includes(storedSortKey) ? storedSortKey : 'purchased';

  const setSortKey = (key: SortKey) => void patchSettings({ inventorySortKey: key });
  const setSortDir = (dir: SortDir) => void patchSettings({ inventorySortDir: dir });
  const toggleHideInvalid = () => void patchSettings({ inventoryHideInvalid: !hideInvalid });

  // «Дата» reads as the purchase for a bought account and as the day it was added for a hand-added one — the same key.
  const sortLabel = (key: SortKey): string =>
    key === 'purchased' && local ? t('inventory.card.addedLabel') : t(`inventory.sort.${key}`);

  // The price inputs are text while they are being typed at; the bounds commit as a pair, on the way out of the field.
  const [minText, setMinText] = useState(priceMin !== null ? String(priceMin) : '');
  const [maxText, setMaxText] = useState(priceMax !== null ? String(priceMax) : '');
  useEffect(() => {
    setMinText(priceMin !== null ? String(priceMin) : '');
    setMaxText(priceMax !== null ? String(priceMax) : '');
  }, [priceMin, priceMax]);
  const commitPrice = () => setPriceRange(parseBound(minText), parseBound(maxText));

  const priceDirty = parseBound(minText) !== priceMin || parseBound(maxText) !== priceMax;

  // On a service tab the chips answer questions about that service — the header says whose.
  const attrsTitle = filter === 'all' ? t('inventory.filters.attrsLabel') : serviceLabel(filter);

  return (
    <Modal
      title={t('inventory.filters.title')}
      size="xl"
      closable
      onClose={onClose}
      footer={
        <>
          {/* Сброс — слева, у края, подальше от «Готово»: он отменяет всё. */}
          <Button variant="ghost" size="sm" disabled={!filtersActive} onClick={resetFilters}>
            {t('inventory.filters.reset')}
          </Button>
          <ModalSpacer />
          <Button variant="accent" size="sm" onClick={onClose}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      <div className={s.layout}>
        <div className={s.col}>
          <ModalGroup>{t('inventory.filters.sortLabel')}</ModalGroup>
          <ModalChips>
            {sortKeys.map((key) => (
              <ModalChip
                key={key}
                label={sortLabel(key)}
                selected={sortKey === key}
                onClick={() => setSortKey(key)}
              />
            ))}
            {/* Направление — той же пилюлей, но без подсветки: оно не одно из значений ряда. */}
            <ModalChip
              icon={ArrowDownUp}
              label={t(sortDir === 'asc' ? 'inventory.sort.asc' : 'inventory.sort.desc')}
              onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
            />
          </ModalChips>

          <ModalGroup>{t('inventory.filters.validityLabel')}</ModalGroup>
          <ModalChips>
            {VALIDITY_ORDER.map((value) => (
              <ModalChip
                key={value}
                label={t(`inventory.card.validity.${value}`)}
                selected={validity.includes(value)}
                onClick={() => toggleValidity(value)}
              />
            ))}
          </ModalChips>

          <ModalChecks>
            <ModalCheck
              checked={hideInvalid}
              disabled={validity.length > 0}
              onChange={() => void toggleHideInvalid()}
            >
              {t('inventory.filters.hideInvalid')}
            </ModalCheck>
          </ModalChecks>
        </div>

        <div className={s.col}>
          {!local && (
            <>
              <ModalGroup>{t('inventory.filters.priceLabel')}</ModalGroup>
              <div className={s.range}>
                <ModalInput
                  type="text"
                  inputMode="decimal"
                  placeholder={t('inventory.filters.priceFrom')}
                  value={minText}
                  aria-label={t('inventory.filters.priceFrom')}
                  onChange={(e) => setMinText(e.target.value)}
                  onBlur={commitPrice}
                  onKeyDown={(e) => e.key === 'Enter' && commitPrice()}
                />
                <ModalInput
                  type="text"
                  inputMode="decimal"
                  placeholder={t('inventory.filters.priceTo')}
                  value={maxText}
                  aria-label={t('inventory.filters.priceTo')}
                  onChange={(e) => setMaxText(e.target.value)}
                  onBlur={commitPrice}
                  onKeyDown={(e) => e.key === 'Enter' && commitPrice()}
                />
              </div>
              {/* An unapplied window would look applied — the fields are honest about it. */}
              {priceDirty && <small>{t('inventory.filters.pricePending')}</small>}
            </>
          )}

          {local && (
            <>
              <ModalGroup>{t('inventory.filters.folderLabel')}</ModalGroup>
              <ModalChips>
                <ModalChip
                  label={t('inventory.filters.folderAny')}
                  selected={folder === null}
                  onClick={() => setFolder(null)}
                />
                <ModalChip
                  label={t('inventory.card.moveFolder.root')}
                  selected={folder === ''}
                  onClick={() => setFolder(folder === '' ? null : '')}
                />
                {folders.map((name) => (
                  <ModalChip
                    key={name}
                    label={name}
                    selected={folder === name}
                    onClick={() => setFolder(folder === name ? null : name)}
                  />
                ))}
              </ModalChips>
            </>
          )}

          {/* The chips above say the same thing with more precision. */}
          {labels.length > 0 && (
            <>
              <LabelMultiSelect
                title={t('inventory.filters.labelInclude')}
                labels={labels}
                selected={includeLabels}
                onToggle={toggleInclude}
                variant="include"
              />
              <LabelMultiSelect
                title={t('inventory.filters.labelExclude')}
                labels={labels}
                selected={excludeLabels}
                onToggle={toggleExclude}
                variant="exclude"
              />
            </>
          )}
        </div>

        <div className={s.col}>
          {chips.length > 0 && (
            <>
              <ModalGroup>{attrsTitle}</ModalGroup>
              <ModalChips>
                {chips.map((attr) => (
                  <ModalChip
                    key={attr.id}
                    label={t(`inventory.filters.attrs.${attr.id}`)}
                    selected={attrs.includes(attr.id)}
                    onClick={() => toggleAttr(attr.id)}
                  />
                ))}
              </ModalChips>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

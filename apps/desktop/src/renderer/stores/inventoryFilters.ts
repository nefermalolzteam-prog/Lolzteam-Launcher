import type {
  AccountScope,
  AccountValidity,
  InventoryCategory,
  InventoryCategoryFilters,
  LauncherSettings,
  LlmServiceId,
} from '@shared-types';
import { SERVICE_IDS } from '@shared-types';
import { create } from 'zustand';
import { useAccountsStream } from './accountsStream';
import { patchSettings, useSettings } from './settings';

/** Category tab: one service, or every service at once. */
export type InventoryFilter = InventoryCategory;
/** Provider narrowing shown only while the LLM tab is selected. */
export type LlmFilter = LlmServiceId | 'all';
/** The dialog's selections for one category tab. */
export type CategoryFilters = InventoryCategoryFilters;

/** Every category tab's filters, keyed by tab. */
type FiltersByCategory = Partial<Record<InventoryFilter, CategoryFilters>>;

/** The filters of a tab nobody has touched. */
const NO_FILTERS: CategoryFilters = Object.freeze({
  includeLabels: [] as number[],
  excludeLabels: [] as number[],
  attrs: [] as string[],
  validity: [] as AccountValidity[],
  folder: null,
});

const isEmpty = (f: CategoryFilters): boolean =>
  f.includeLabels.length === 0 &&
  f.excludeLabels.length === 0 &&
  f.attrs.length === 0 &&
  f.validity.length === 0 &&
  f.folder === null;

interface InventoryFiltersState {
  scope: AccountScope;
  filter: InventoryFilter;
  llmService: LlmFilter;
  search: string;
  /** The filters themselves, per category tab. */
  byCategory: FiltersByCategory;
  setScope: (scope: AccountScope) => void;
  setFilter: (filter: InventoryFilter) => void;
  setLlmService: (value: LlmFilter) => void;
  setSearch: (search: string) => void;
  toggleInclude: (id: number) => void;
  toggleExclude: (id: number) => void;
  toggleAttr: (id: string) => void;
  toggleValidity: (value: AccountValidity) => void;
  setFolder: (folder: string | null) => void;
  /** Clears the open tab's filters and leaves every other tab alone. */
  resetCategory: () => void;
  /** Drops the folder selection everywhere — for a switch to another base. */
  clearFolders: () => void;
  /** Drops selections whose label no longer exists in the palette. */
  keepLabels: (alive: ReadonlySet<number>) => void;
}

/** Applies a patch to the open tab's filters. */
const editActive = (
  st: InventoryFiltersState,
  patch: (cur: CategoryFilters) => Partial<CategoryFilters>,
): Pick<InventoryFiltersState, 'byCategory'> => {
  const cur = st.byCategory[st.filter] ?? NO_FILTERS;
  const next: CategoryFilters = { ...cur, ...patch(cur) };
  const byCategory: FiltersByCategory = { ...st.byCategory };
  if (isEmpty(next)) delete byCategory[st.filter];
  else byCategory[st.filter] = next;
  return { byCategory };
};

/** Inventory filter state, lifted out of `InventoryView` so the top bar can own the toolbar while the grid stays where it. */
export const useInventoryFilters = create<InventoryFiltersState>((set) => ({
  scope: useAccountsStream.getState().activeScope,
  filter: 'all',
  llmService: 'all',
  search: '',
  byCategory: {},

  // Switching scope resets the category: the tab set differs per scope (local only lists services that can log in offline).
  setScope: (scope) => set({ scope, filter: 'all', llmService: 'all' }),

  // Leaving the LLM tab clears the per-provider narrowing.
  setFilter: (filter) => set(filter === 'llm' ? { filter } : { filter, llmService: 'all' }),

  setLlmService: (llmService) => set({ llmService }),
  setSearch: (search) => set({ search }),

  toggleInclude: (id) =>
    set((st) =>
      editActive(st, (cur) => ({
        excludeLabels: cur.excludeLabels.filter((x) => x !== id),
        includeLabels: cur.includeLabels.includes(id)
          ? cur.includeLabels.filter((x) => x !== id)
          : [...cur.includeLabels, id],
      })),
    ),

  toggleExclude: (id) =>
    set((st) =>
      editActive(st, (cur) => ({
        includeLabels: cur.includeLabels.filter((x) => x !== id),
        excludeLabels: cur.excludeLabels.includes(id)
          ? cur.excludeLabels.filter((x) => x !== id)
          : [...cur.excludeLabels, id],
      })),
    ),

  toggleAttr: (id) =>
    set((st) =>
      editActive(st, (cur) => ({
        attrs: cur.attrs.includes(id) ? cur.attrs.filter((x) => x !== id) : [...cur.attrs, id],
      })),
    ),

  toggleValidity: (value) =>
    set((st) =>
      editActive(st, (cur) => ({
        validity: cur.validity.includes(value)
          ? cur.validity.filter((v) => v !== value)
          : [...cur.validity, value],
      })),
    ),

  setFolder: (folder) => set((st) => editActive(st, () => ({ folder }))),

  resetCategory: () =>
    set((st) => {
      if (!st.byCategory[st.filter]) return st;
      const byCategory: FiltersByCategory = { ...st.byCategory };
      delete byCategory[st.filter];
      return { byCategory };
    }),

  clearFolders: () =>
    set((st) =>
      mapCategories(st.byCategory, (f) => (f.folder === null ? f : { ...f, folder: null })),
    ),

  keepLabels: (alive) =>
    set((st) =>
      mapCategories(st.byCategory, (f) => {
        // Keep the same object identity when nothing was dropped, so subscribers don't re-render on every palette refresh.
        const include = f.includeLabels.every((id) => alive.has(id));
        const exclude = f.excludeLabels.every((id) => alive.has(id));
        if (include && exclude) return f;
        return {
          ...f,
          includeLabels: include ? f.includeLabels : f.includeLabels.filter((id) => alive.has(id)),
          excludeLabels: exclude ? f.excludeLabels : f.excludeLabels.filter((id) => alive.has(id)),
        };
      }),
    ),
}));

/** Rewrites every tab's filters through `edit`, keeping the whole map's identity when no tab actually changed. */
const mapCategories = (
  byCategory: FiltersByCategory,
  edit: (f: CategoryFilters) => CategoryFilters,
): Pick<InventoryFiltersState, 'byCategory'> | Record<string, never> => {
  let changed = false;
  const next: FiltersByCategory = {};
  for (const [key, value] of Object.entries(byCategory) as [
    InventoryFilter,
    CategoryFilters | undefined,
  ][]) {
    if (!value) continue;
    const edited = edit(value);
    if (edited !== value) changed = true;
    if (!isEmpty(edited)) next[key] = edited;
    else changed = true;
  }
  return changed ? { byCategory: next } : {};
};

/** The open tab's filters — the one way to read them. */
export const useActiveFilters = (): CategoryFilters =>
  useInventoryFilters((st) => st.byCategory[st.filter] ?? NO_FILTERS);

/** Reads the open tab's filters outside React. */
export const activeFilters = (): CategoryFilters => {
  const st = useInventoryFilters.getState();
  return st.byCategory[st.filter] ?? NO_FILTERS;
};

const VALIDITIES: readonly AccountValidity[] = ['valid', 'unknown', 'invalid'];
const CATEGORIES = new Set<string>(['all', ...SERVICE_IDS]);

const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : [];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** One stored entry, taken apart field by field. */
const readEntry = (raw: unknown): CategoryFilters | null => {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const entry: CategoryFilters = {
    includeLabels: numbers(src.includeLabels),
    excludeLabels: numbers(src.excludeLabels),
    attrs: strings(src.attrs),
    validity: strings(src.validity).filter((v): v is AccountValidity =>
      VALIDITIES.includes(v as AccountValidity),
    ),
    folder: typeof src.folder === 'string' ? src.folder : null,
  };
  return isEmpty(entry) ? null : entry;
};

const readStored = (raw: LauncherSettings['inventoryFilters']): FiltersByCategory => {
  const out: FiltersByCategory = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    // A category the registry no longer knows would otherwise sit in the file forever.
    if (!CATEGORIES.has(key)) continue;
    const entry = readEntry(value);
    if (entry) out[key as InventoryFilter] = entry;
  }
  return out;
};

/** Chips are clicked in bursts — three in a row while the dialog is open. */
const SAVE_DELAY = 300;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const schedulePersist = (byCategory: FiltersByCategory): void => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void patchSettings({ inventoryFilters: byCategory });
  }, SAVE_DELAY);
};

let hydrated = false;
let started = false;

/** Loads the stored filters once, then keeps the file in step with the store. */
export const initInventoryFilters = (): void => {
  if (started) return;
  started = true;

  const hydrate = (settings: LauncherSettings | null): void => {
    if (!settings || hydrated) return;
    hydrated = true;
    stop?.();
    const { byCategory } = useInventoryFilters.getState();
    if (Object.keys(byCategory).length > 0) {
      schedulePersist(byCategory);
      return;
    }
    const stored = readStored(settings.inventoryFilters);
    if (Object.keys(stored).length > 0) useInventoryFilters.setState({ byCategory: stored });
  };

  const stop = useSettings.subscribe((st) => hydrate(st.settings));
  hydrate(useSettings.getState().settings);
};

// Every mutator above just edits state; this is the single place that decides when the result goes to disk.
useInventoryFilters.subscribe((st, prev) => {
  if (hydrated && st.byCategory !== prev.byCategory) schedulePersist(st.byCategory);
});

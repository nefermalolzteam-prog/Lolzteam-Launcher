import { create } from 'zustand';

/** What the mass bar can be asked to do. */
export type MassActionId = 'check' | 'profile' | 'cleanup' | 'privacy' | 'friends' | 'link';

interface InventorySelectionState {
  ids: ReadonlySet<number>;
  /** An action the grid asked for and the bar has not opened yet. */
  pending: MassActionId | null;
  toggle: (itemId: number) => void;
  /** Replaces the selection outright — "select all", and "clear". */
  replace: (ids: Iterable<number>) => void;
  clear: () => void;
  /** Select exactly these accounts and ask the bar for `action`. */
  askFor: (ids: Iterable<number>, action: MassActionId) => void;
  /** Called by the bar once it has the request on screen. */
  clearPending: () => void;
}

export const useInventorySelection = create<InventorySelectionState>((set) => ({
  ids: new Set<number>(),
  pending: null,
  toggle: (itemId) =>
    set((state) => {
      const ids = new Set(state.ids);
      if (!ids.delete(itemId)) ids.add(itemId);
      return { ids };
    }),
  replace: (ids) => set({ ids: new Set(ids) }),
  clear: () => set({ ids: new Set<number>(), pending: null }),
  askFor: (ids, action) => set({ ids: new Set(ids), pending: action }),
  clearPending: () => set({ pending: null }),
}));

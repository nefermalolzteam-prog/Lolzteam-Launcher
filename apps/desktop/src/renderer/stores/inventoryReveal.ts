import type { AccountScope } from '@shared-types';
import { create } from 'zustand';
import { useInventoryFilters } from './inventoryFilters';
import { useView } from './view';

/** Один аккаунт, который список должен показать — потому что о нём спросили откуда-то ещё. */
interface InventoryRevealState {
  /** Кого показываем. */
  itemId: number | null;
  /** Растёт на каждый запрос, чтобы повтор по тому же аккаунту тоже сработал. */
  nonce: number;
  reveal: (itemId: number) => void;
  clear: () => void;
}

/** Сколько запрос живёт, если его никто не исполнил. */
const TTL_MS = 6_000;

let ttl: ReturnType<typeof setTimeout> | null = null;

const stopTtl = (): void => {
  if (ttl === null) return;
  clearTimeout(ttl);
  ttl = null;
};

export const useInventoryReveal = create<InventoryRevealState>((set) => ({
  itemId: null,
  nonce: 0,
  // `nonce` не сбрасывается вместе с `itemId`: он общий счётчик запросов, а не часть текущего.
  reveal: (itemId) => set((st) => ({ itemId, nonce: st.nonce + 1 })),
  clear: () => {
    stopTtl();
    set({ itemId: null });
  },
}));

/** Показать аккаунт: увести список туда, где он вообще может быть видно, и пометить его как искомый. */
export const revealAccount = (itemId: number, scope: AccountScope): void => {
  const filters = useInventoryFilters.getState();
  filters.setScope(scope);
  filters.setSearch('');
  filters.resetCategory();
  useView.getState().setView('inventory');

  useInventoryReveal.getState().reveal(itemId);
  stopTtl();
  ttl = setTimeout(() => {
    ttl = null;
    useInventoryReveal.getState().clear();
  }, TTL_MS);
};

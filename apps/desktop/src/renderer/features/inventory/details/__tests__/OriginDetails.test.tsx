import type { AccountSummary } from '@shared-types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useInventoryFilters } from '~/stores/inventoryFilters';
import { useInventoryReveal } from '~/stores/inventoryReveal';
import { renderWithProviders, t } from '~/testing/render';
import { OriginDetails } from '../OriginDetails';

const item = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  itemId: 42,
  category: 'telegram',
  categoryRaw: 'telegram',
  categoryTitle: 'Telegram',
  title: 'Аккаунт',
  description: '',
  price: 0,
  currency: 'RUB',
  imageUrl: null,
  tags: [],
  warrantyEndsAt: null,
  publishedAt: null,
  purchasedAt: null,
  isPurchased: true,
  scope: 'purchased',
  steam: null,
  telegram: null,
  discord: null,
  instagram: null,
  tiktok: null,
  llmService: null,
  llm: null,
  hasEmailLogin: false,
  hasMafile: null,
  note: null,
  folder: null,
  marketItemId: null,
  localCopyId: null,
  ...over,
});

beforeEach(() => {
  useInventoryFilters.setState({ scope: 'purchased', filter: 'all', search: '', byCategory: {} });
});

// `clear` снимает и предохранитель — иначе таймер на шесть секунд пережил бы тест и погасил бы запрос уже в следующем.
afterEach(() => useInventoryReveal.getState().clear());

/** Список, каким его видит панель. */
const seedAccounts = (
  queryClient: ReturnType<typeof renderWithProviders>['queryClient'],
  items: AccountSummary[],
): void => {
  queryClient.setQueryDefaults(['accounts'], { gcTime: Number.POSITIVE_INFINITY });
  queryClient.setQueryData<AccountSummary[]>(['accounts'], items);
};

describe('OriginDetails', () => {
  it('молчит, когда аккаунт ни с чем не связан', () => {
    const { container } = renderWithProviders(<OriginDetails item={item()} compact={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ведёт в базу — на ту вкладку, где копия лежит по данным списка', async () => {
    const user = userEvent.setup();
    useInventoryFilters.setState({ scope: 'purchased', filter: 'telegram', search: 'ищем' });

    const { queryClient } = renderWithProviders(
      <OriginDetails item={item({ localCopyId: -7 })} compact={false} />,
    );
    seedAccounts(queryClient, [item({ itemId: -7, scope: 'local' })]);

    await user.click(screen.getByRole('button', { name: t('inventory.card.origin.inBase') }));

    const filters = useInventoryFilters.getState();
    expect(filters.scope).toBe('local');
    // Вкладку категории сбрасывает `setScope`, поиск — сам `revealAccount`.
    expect(filters.filter).toBe('all');
    expect(filters.search).toBe('');
    expect(useInventoryReveal.getState().itemId).toBe(-7);
  });

  it('ведёт на маркет и берёт вкладку у самого лота, а не по стороне бейджа', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(
      <OriginDetails
        item={item({ itemId: -7, scope: 'local', marketItemId: 42 })}
        compact={false}
      />,
    );
    // Свой лот, а не купленный: копию в базу можно сделать с обоих.
    seedAccounts(queryClient, [item({ itemId: 42, scope: 'listed' })]);

    await user.click(screen.getByRole('button', { name: t('inventory.card.origin.fromMarket') }));

    expect(useInventoryFilters.getState().scope).toBe('listed');
    expect(useInventoryReveal.getState().itemId).toBe(42);
  });

  it('без ответа в списке идёт на вкладку, где связанному аккаунту место', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OriginDetails item={item({ localCopyId: -7 })} compact={false} />);

    await user.click(screen.getByRole('button', { name: t('inventory.card.origin.inBase') }));

    expect(useInventoryFilters.getState().scope).toBe('local');
  });

  it('считает запросы, чтобы повтор по тому же аккаунту тоже сработал', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OriginDetails item={item({ localCopyId: -7 })} compact={false} />);
    const badge = screen.getByRole('button', { name: t('inventory.card.origin.inBase') });

    await user.click(badge);
    const first = useInventoryReveal.getState().nonce;
    await user.click(badge);

    expect(useInventoryReveal.getState().nonce).toBe(first + 1);
  });
});

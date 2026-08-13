import type { AccountSummary } from '@shared-types';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInventoryReveal } from '~/stores/inventoryReveal';
import { useLoginSession } from '~/stores/loginSession';
import { installLauncher } from '~/testing/launcher';
import { renderWithProviders, t } from '~/testing/render';
import { AccountCard } from '../AccountCard';
import { formatPrice } from '../cardFormat';

const item = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  itemId: 42,
  category: 'discord',
  categoryRaw: 'discord',
  categoryTitle: 'Discord',
  title: 'Аккаунт с нитро',
  description: '',
  price: 150,
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

/** A hand-added account: no price, no market page, its own menu. */
const local = (over: Partial<AccountSummary> = {}): AccountSummary =>
  item({
    itemId: 7,
    category: 'telegram',
    categoryRaw: 'telegram',
    categoryTitle: 'Telegram',
    title: 'Свой аккаунт',
    scope: 'local',
    isPurchased: false,
    price: 0,
    currency: '',
    ...over,
  });

/** A price as `getByText` will see it. */
const asRendered = (value: string): string => value.replace(/\s+/g, ' ');

/** The «⋯» button, which carries no label of its own — only the state it toggles. */
const menuButton = () => screen.getByRole('button', { expanded: false });

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(menuButton());
};

// A login leaves the session store running, and `busy` is read from it by id.
afterEach(() => useLoginSession.getState().close());

describe('AccountCard', () => {
  it('says the same things about one account whichever shape draws it', () => {
    const account = item();
    const expected = [account.title, t('inventory.card.validity.unknown')];
    const price = asRendered(formatPrice(150, 'RUB', 'ru'));

    const tile = renderWithProviders(<AccountCard item={account} />);
    for (const text of expected) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(price)).toBeInTheDocument();
    tile.unmount();

    renderWithProviders(<AccountCard item={account} asRow index={1} />);
    for (const text of expected) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(price)).toBeInTheDocument();
  });

  it('numbers a row that cannot be selected and ticks one that can', async () => {
    const user = userEvent.setup();
    const account = item();
    const onSelect = vi.fn();

    const plain = renderWithProviders(<AccountCard item={account} asRow index={9} />);
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    plain.unmount();

    renderWithProviders(
      <AccountCard item={account} asRow index={9} selectable onSelect={onSelect} />,
    );
    // The number gives up its column to the checkbox rather than sharing it.
    expect(screen.queryByText('9')).toBeNull();
    const box = screen.getByRole('checkbox', { name: account.title });
    expect(box).toHaveAttribute('aria-checked', 'false');

    await user.click(box);
    expect(onSelect).toHaveBeenCalledWith(account);
  });

  it('offers the tick on a card too, in its header', () => {
    renderWithProviders(<AccountCard item={item()} selectable selected />);
    expect(screen.getByRole('checkbox', { name: 'Аккаунт с нитро' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('signs in through the one method the service has, without asking first', async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => ({ ok: true }));
    installLauncher({ accounts: { login } });

    renderWithProviders(<AccountCard item={item()} />);
    await user.click(screen.getByRole('button', { name: t('inventory.card.login') }));

    // Discord has no native client to fall back.
    expect(login).toHaveBeenCalledWith(42, 'web', null, null);
  });

  it('draws the same login button on a row, and it does the same thing', async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => ({ ok: true }));
    installLauncher({ accounts: { login } });

    renderWithProviders(<AccountCard item={item()} asRow index={1} />);
    await user.click(screen.getByRole('button', { name: t('inventory.card.login') }));

    expect(login).toHaveBeenCalledWith(42, 'web', null, null);
  });

  it('opens the market menu for a bought account', async () => {
    const user = userEvent.setup();
    const openExternal = vi.fn();
    installLauncher({ app: { openExternal } });

    renderWithProviders(<AccountCard item={item()} />);
    await openMenu(user);

    expect(
      screen.getByRole('menuitem', { name: t('inventory.card.checkValidity') }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: t('inventory.card.openFolder') })).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: t('inventory.card.openOnMarket') }));
    expect(openExternal).toHaveBeenCalledWith('https://lzt.market/42/');
  });

  it('opens the base menu for a hand-added one, edit and delete included', async () => {
    const user = userEvent.setup();
    const account = local();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    renderWithProviders(
      <AccountCard item={account} asRow index={1} onEdit={onEdit} onDelete={onDelete} />,
    );
    await openMenu(user);

    expect(
      screen.getByRole('menuitem', { name: t('inventory.card.openFolder') }),
    ).toBeInTheDocument();
    // A local account has no item page and nothing on the market to check.
    expect(screen.queryByRole('menuitem', { name: t('inventory.card.openOnMarket') })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: t('inventory.card.checkValidity') })).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: t('inventory.card.deleteLocal') }));
    expect(onDelete).toHaveBeenCalledWith(account);
  });

  it('shows a local account no price at all, rather than a zero', () => {
    renderWithProviders(<AccountCard item={local()} />);
    expect(screen.queryByText(t('inventory.card.priceLabel'))).toBeNull();
  });

  /** Подсветку рисует CSS, но снимает запрос сама карточка — по концу анимации. */
  it('снимает запрос показа только по своей вспышке, а не по чужой', () => {
    const account = item();
    useInventoryReveal.setState({ itemId: account.itemId, nonce: 1 });
    const { container } = renderWithProviders(<AccountCard item={account} />);
    const card = container.querySelector('article');
    expect(card).not.toBeNull();

    fireEvent.animationEnd(screen.getByText(account.title));
    expect(useInventoryReveal.getState().itemId).toBe(account.itemId);

    fireEvent.animationEnd(card as HTMLElement);
    expect(useInventoryReveal.getState().itemId).toBeNull();
  });
});

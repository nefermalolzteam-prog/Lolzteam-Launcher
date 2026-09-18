import type { AccountSummary, ListingCapabilities } from '@shared-types';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders, t } from '~/testing/render';
import { WarrantyDetails } from '../WarrantyDetails';

const DAY = 86_400;

const caps = (over: Partial<ListingCapabilities> = {}): ListingCapabilities => ({
  canOpen: false,
  canClose: true,
  canEdit: true,
  canDelete: true,
  canStick: false,
  canUnstick: false,
  canBump: true,
  canAutoBump: true,
  bumpBlockedReason: null,
  autoBumpHours: null,
  guaranteeSeconds: null,
  titleEn: null,
  allowAskDiscount: null,
  origin: null,
  emailType: null,
  ...over,
});

const item = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  itemId: 42,
  category: 'steam',
  categoryRaw: 'steam',
  categoryTitle: 'Steam',
  title: 'Аккаунт',
  description: '',
  price: 100,
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

describe('WarrantyDetails — свой лот', () => {
  it('показывает длительность, которую получит покупатель', () => {
    renderWithProviders(
      <WarrantyDetails
        item={item({ scope: 'listed', listing: caps({ guaranteeSeconds: 3 * DAY }) })}
        compact={false}
      />,
    );
    expect(
      screen.getByText(
        t('inventory.card.warranty_active', {
          left: t('inventory.card.warrantyDays', { count: 3 }),
        }),
      ),
    ).toBeInTheDocument();
  });

  it('«без гарантии», когда лот её не даёт', () => {
    renderWithProviders(
      <WarrantyDetails
        item={item({ scope: 'listed', listing: caps({ guaranteeSeconds: null }) })}
        compact={false}
      />,
    );
    expect(screen.getByText(t('inventory.card.warranty_none'))).toBeInTheDocument();
  });

  it('не путает свой лот с купленным: у купленного считается срок до конца', () => {
    const endsAt = Math.floor(Date.now() / 1000) + 2 * DAY;
    renderWithProviders(
      <WarrantyDetails item={item({ warrantyEndsAt: endsAt })} compact={false} />,
    );
    expect(
      screen.getByText(
        t('inventory.card.warranty_active', {
          left: t('inventory.card.warrantyDays', { count: 2 }),
        }),
      ),
    ).toBeInTheDocument();
  });

  it('истёкшая гарантия купленного аккаунта так и подписана', () => {
    const endsAt = Math.floor(Date.now() / 1000) - DAY;
    renderWithProviders(
      <WarrantyDetails item={item({ warrantyEndsAt: endsAt })} compact={false} />,
    );
    expect(screen.getByText(t('inventory.card.warranty_expired'))).toBeInTheDocument();
  });

  it('у аккаунта из локальной базы бейджа нет вовсе', () => {
    const { container } = renderWithProviders(
      <WarrantyDetails item={item({ scope: 'local' })} compact={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

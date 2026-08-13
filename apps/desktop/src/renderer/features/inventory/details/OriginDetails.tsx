import type { AccountScope, AccountSummary } from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { revealAccount } from '~/stores/inventoryReveal';
import { CubeIcon, MarketIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** Which tab the counterpart lives on. */
const scopeOf = (
  items: readonly AccountSummary[] | undefined,
  itemId: number,
  fallback: AccountScope,
): AccountScope => items?.find((it) => it.itemId === itemId)?.scope ?? fallback;

export const OriginDetails = ({ item }: AccountDetailsProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();

  /** The copy lives in the local base, so `localCopyId` is a local `itemId` — the ids are one space. */
  const localCopyId = item.localCopyId;
  const marketItemId = item.marketItemId;

  if (marketItemId !== null) {
    return (
      <div className={s.badges}>
        <Badge
          tone="neutral"
          icon={<MarketIcon size={12} />}
          title={t('inventory.card.origin.fromMarketTitle', { itemId: marketItemId })}
          onClick={() =>
            revealAccount(
              marketItemId,
              // A bought item unless the list says otherwise: the user's own listing can be copied to the base just the same.
              scopeOf(qc.getQueryData<AccountSummary[]>(['accounts']), marketItemId, 'purchased'),
            )
          }
        >
          {t('inventory.card.origin.fromMarket')}
        </Badge>
      </div>
    );
  }

  if (localCopyId !== null) {
    return (
      <div className={s.badges}>
        <Badge
          tone="ok"
          icon={<CubeIcon size={12} />}
          title={t('inventory.card.origin.inBaseTitle')}
          onClick={() =>
            revealAccount(
              localCopyId,
              scopeOf(qc.getQueryData<AccountSummary[]>(['accounts']), localCopyId, 'local'),
            )
          }
        >
          {t('inventory.card.origin.inBase')}
        </Badge>
      </div>
    );
  }

  return null;
};

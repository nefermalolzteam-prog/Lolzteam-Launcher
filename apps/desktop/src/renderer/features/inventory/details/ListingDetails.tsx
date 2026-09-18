import { useTranslation } from 'react-i18next';
import { AutoBumpIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/**
 * What runs on the seller's own listing without them: only auto-bump so far,
 * and only when it is actually set — an off switch is not news.
 */
export const ListingDetails = ({ item, controls }: AccountDetailsProps) => {
  const { t } = useTranslation();
  const hours = item.listing?.autoBumpHours ?? null;
  if (hours === null) return null;

  return (
    <div className={s.badges}>
      <Badge
        icon={<AutoBumpIcon size={12} />}
        title={t('inventory.card.listing.autoBumpBadgeTitle')}
        // The badge states a fact the user most likely wants to change.
        onClick={controls?.openAutoBump}
      >
        {t('inventory.card.listing.autoBumpBadge', { hour: hours })}
      </Badge>
    </div>
  );
};

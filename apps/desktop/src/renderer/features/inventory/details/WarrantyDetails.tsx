import { useTranslation } from 'react-i18next';
import { formatDuration, formatWarranty } from '~/lib/loginService';
import { ShieldCheckIcon, ShieldOffIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** The market's own promise about the item: still ticking, spent, or never made. */
export const WarrantyDetails = ({ item }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();

  // A hand-added account has no seller and no promise — the badge would only be noise.
  if (item.scope === 'local') return null;

  // The user's own listing has nothing to count down: its guarantee only starts
  // when someone buys it, so the badge shows the length being offered instead.
  if (item.listing) {
    const offered = formatDuration(item.listing.guaranteeSeconds, t);
    return (
      <div className={s.badges}>
        {offered === null ? (
          <Badge tone="neutral" icon={<ShieldOffIcon size={12} />}>
            {t('inventory.card.warranty_none')}
          </Badge>
        ) : (
          <Badge
            tone="ok"
            icon={<ShieldCheckIcon size={12} />}
            title={t('inventory.card.warranty_offer_title')}
          >
            {t('inventory.card.warranty_active', { left: offered })}
          </Badge>
        )}
      </div>
    );
  }

  const until = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format((item.warrantyEndsAt ?? 0) * 1000);

  if (!item.warrantyEndsAt) {
    return (
      <div className={s.badges}>
        <Badge tone="neutral" icon={<ShieldOffIcon size={12} />}>
          {t('inventory.card.warranty_none')}
        </Badge>
      </div>
    );
  }

  const left = formatWarranty(item.warrantyEndsAt, t);
  if (left === null) {
    return (
      <div className={s.badges}>
        <Badge tone="warn" icon={<ShieldOffIcon size={12} />} title={until}>
          {t('inventory.card.warranty_expired')}
        </Badge>
      </div>
    );
  }

  return (
    <div className={s.badges}>
      <Badge
        tone="ok"
        icon={<ShieldCheckIcon size={12} />}
        title={t('inventory.card.warranty_until', { date: until })}
      >
        {t('inventory.card.warranty_active', { left })}
      </Badge>
    </div>
  );
};

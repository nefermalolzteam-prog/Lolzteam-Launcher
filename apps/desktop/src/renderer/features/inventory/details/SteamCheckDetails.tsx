import { useTranslation } from 'react-i18next';
import { useSteamChecks } from '~/stores/steamChecks';
import {
  ClockIcon,
  CrossIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  UsersIcon,
} from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { formatShortDate } from '../cardFormat';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** What the launcher's own Steam check found, as opposed to what the market claimed. */
export const SteamCheckDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const check = useSteamChecks((st) =>
    item.category === 'steam' ? st.checks.get(item.itemId) : undefined,
  );

  // `unlinked` is «мы не знаем», not a verdict — nothing was asked of Steam.
  if (!check || check.status !== 'alive') return null;

  const fromMarket = item.steam !== null;
  const showVac = !fromMarket && check.vacBanned === true;
  const showTrade = !fromMarket && check.tradeBanState !== null && check.tradeBanState !== 'None';
  const showLimited = !fromMarket && check.limited === true;
  const showPrivacy = check.privacy !== null;
  const showChecked = !compact && check.checkedAt > 0;

  // An empty strip is not nothing — it is a `gap` between the panels around it, in the row and in the card alike.
  if (!showVac && !showTrade && !showLimited && !showPrivacy && !showChecked) return null;

  return (
    <div className={s.badges}>
      {showVac && (
        <Badge tone="danger" icon={<CrossIcon size={12} />}>
          {t('inventory.card.steam.banVac')}
        </Badge>
      )}
      {showTrade && (
        <Badge tone="danger" icon={<CrossIcon size={12} />}>
          {t('inventory.card.steam.banTrade')}
        </Badge>
      )}
      {showLimited && (
        <Badge tone="warn" icon={<LockIcon size={12} />}>
          {t('inventory.card.steam.limited')}
        </Badge>
      )}
      {showPrivacy && (
        <Badge
          // Only «public» is a green fact here: a private profile is the normal state of a fresh account, not a problem.
          tone={check.privacy === 'public' ? 'ok' : 'neutral'}
          icon={
            check.privacy === 'public' ? (
              <EyeIcon size={12} />
            ) : check.privacy === 'friendsonly' ? (
              <UsersIcon size={12} />
            ) : (
              <EyeOffIcon size={12} />
            )
          }
          title={t('inventory.card.steamCheck.privacyTitle')}
        >
          {t(`inventory.card.steamCheck.privacy.${check.privacy}`, {
            defaultValue: check.privacy,
          })}
        </Badge>
      )}
      {showChecked && (
        <Badge icon={<ClockIcon size={12} />} title={new Date(check.checkedAt).toLocaleString()}>
          {t('inventory.card.steamCheck.checkedAt', {
            date: formatShortDate(Math.floor(check.checkedAt / 1000), i18n.language),
          })}
        </Badge>
      )}
    </div>
  );
};

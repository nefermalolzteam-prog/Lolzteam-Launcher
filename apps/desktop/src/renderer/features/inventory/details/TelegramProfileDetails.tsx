import { useTranslation } from 'react-i18next';
import { profileVerdict, rowVerdict } from '~/features/base/taskVerdict';
import { sentence } from '~/lib/sentence';
import { useTelegramProfiles } from '~/stores/telegramProfiles';
import { useTelegramTasks } from '~/stores/telegramTasks';
import { ClockIcon, CrossIcon, ScreenIcon, StarIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { formatShortDate } from '../cardFormat';
import { isCheckable } from '../checkable';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** What the launcher's own checker found, as opposed to what the market claimed. */
export const TelegramProfileDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const profile = useTelegramProfiles((st) =>
    item.category === 'telegram' ? st.profiles.get(item.itemId) : undefined,
  );
  // Живая строка прогона — чтобы спросить у вердикта, что он уже сказал.
  const row = useTelegramTasks((st) => st.rows.get(item.itemId));
  if (!profile || profile.status === 'dead') return null;

  const fromMarket = item.telegram !== null;
  const spam = profile.spam;
  const showPremium = !fromMarket && profile.premium;
  const wantsSpam = !fromMarket && spam !== null && spam.status !== 'free';
  const wantsSessions = profile.sessions !== null;
  /** Что уже стоит в бейдже вердикта слева — спрошено у него самого. */
  const covered =
    (wantsSpam || wantsSessions) && isCheckable(item)
      ? (row ? rowVerdict(row, t) : profileVerdict(profile, t)).covers
      : null;
  const showSpam = wantsSpam && covered !== 'spam';
  const showSessions = wantsSessions && covered !== 'sessions';
  const showChecked = !compact;
  // An empty strip is not nothing: it is a `gap` between the panels around it, in the row and in the card alike.
  if (!showPremium && !showSpam && !showSessions && !showChecked) return null;

  return (
    <div className={s.badges}>
      {showPremium && (
        <Badge tone="ok" icon={<StarIcon size={12} />}>
          {t('inventory.card.telegram.premium')}
        </Badge>
      )}
      {showSpam && spam && (
        <Badge tone={spam.status === 'blocked' ? 'danger' : 'warn'} icon={<CrossIcon size={12} />}>
          {spam.until
            ? t('inventory.card.telegram.spamBlockUntil', {
                date: formatShortDate(Math.floor(spam.until / 1000), i18n.language),
              })
            : // for the run verdicts and arrives lowercase.
              sentence(t(`base.spam.${spam.status}`))}
        </Badge>
      )}
      {showSessions && (
        <Badge icon={<ScreenIcon size={12} />}>
          {sentence(t('base.status.sessions', { count: profile.sessions ?? 0 }))}
        </Badge>
      )}
      {showChecked && (
        <Badge icon={<ClockIcon size={12} />} title={new Date(profile.checkedAt).toLocaleString()}>
          {t('inventory.card.telegram.checkedAt', {
            date: formatShortDate(Math.floor(profile.checkedAt / 1000), i18n.language),
          })}
        </Badge>
      )}
    </div>
  );
};

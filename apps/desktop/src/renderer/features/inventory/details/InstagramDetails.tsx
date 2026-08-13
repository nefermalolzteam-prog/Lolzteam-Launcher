import { useTranslation } from 'react-i18next';
import {
  AlertIcon,
  CalendarIcon,
  CookieIcon,
  GridIcon,
  KeyIcon,
  PhoneIcon,
  TagIcon,
  UserPlusIcon,
  UsersIcon,
} from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { formatCount, formatFullDate, hasDate } from '../cardFormat';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** What the market knows about an Instagram item. */
export const InstagramDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const ig = item.instagram;
  const locale = i18n.language;
  if (!ig) return null;

  return (
    <div className={s.badges}>
      {typeof ig.followerCount === 'number' && (
        <Badge icon={<UsersIcon size={12} />}>
          {t('inventory.card.instagram.followers', {
            value: formatCount(ig.followerCount, locale),
          })}
        </Badge>
      )}
      {typeof ig.postCount === 'number' && (
        <Badge icon={<GridIcon size={12} />}>
          {t('inventory.card.instagram.posts', { count: ig.postCount })}
        </Badge>
      )}
      {/* The browser login is a cookie login. */}
      {ig.hasCookies ? (
        <Badge tone="ok" icon={<CookieIcon size={12} />}>
          {t('inventory.card.instagram.cookies')}
        </Badge>
      ) : ig.loginWithoutCookies ? (
        <Badge icon={<KeyIcon size={12} />}>{t('inventory.card.instagram.passwordOnly')}</Badge>
      ) : (
        <Badge tone="warn" icon={<AlertIcon size={12} />}>
          {t('inventory.card.instagram.noCookies')}
        </Badge>
      )}
      {ig.mobile && (
        <Badge tone="ok" icon={<PhoneIcon size={12} />}>
          {t('inventory.card.instagram.mobile')}
        </Badge>
      )}
      {ig.origin && <Badge icon={<TagIcon size={12} />}>{ig.origin}</Badge>}

      {!compact && (
        <>
          {typeof ig.followCount === 'number' && (
            <Badge icon={<UserPlusIcon size={12} />}>
              {t('inventory.card.instagram.following', {
                value: formatCount(ig.followCount, locale),
              })}
            </Badge>
          )}
          {hasDate(ig.registerDate) && (
            <Badge icon={<CalendarIcon size={12} />}>
              {t('inventory.card.instagram.registered', {
                date: formatFullDate(ig.registerDate, locale),
              })}
            </Badge>
          )}
        </>
      )}
    </div>
  );
};

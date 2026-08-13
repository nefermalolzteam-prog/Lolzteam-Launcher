import { Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CalendarIcon,
  CheckIcon,
  HeartIcon,
  LockIcon,
  MailFilledIcon,
  PhoneIcon,
  TagIcon,
  UserPlusIcon,
  UsersIcon,
  VideoIcon,
  WalletIcon,
} from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { countryName, formatCount, formatFullDate, hasDate } from '../cardFormat';
import { Badge, CountryFlag } from './Badge';
import type { AccountDetailsProps } from './types';

/** What the market knows about a TikTok item. */
export const TikTokDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const tt = item.tiktok;
  const locale = i18n.language;
  if (!tt) return null;

  return (
    <div className={s.badges}>
      {typeof tt.followerCount === 'number' && (
        <Badge icon={<UsersIcon size={12} />}>
          {t('inventory.card.tiktok.followers', { value: formatCount(tt.followerCount, locale) })}
        </Badge>
      )}
      {typeof tt.likeCount === 'number' && (
        <Badge icon={<HeartIcon size={12} />}>
          {t('inventory.card.tiktok.likes', { value: formatCount(tt.likeCount, locale) })}
        </Badge>
      )}
      {typeof tt.videoCount === 'number' && (
        <Badge icon={<VideoIcon size={12} />}>
          {t('inventory.card.tiktok.videos', { value: formatCount(tt.videoCount, locale) })}
        </Badge>
      )}
      {tt.verified && (
        <Badge tone="ok" icon={<CheckIcon size={12} />}>
          {t('inventory.card.tiktok.verified')}
        </Badge>
      )}
      {/* Not a defect, but it is the reason a bought account shows nothing to anyone who is not already an approved follower. */}
      {tt.privateAccount && (
        <Badge tone="warn" icon={<LockIcon size={12} />}>
          {t('inventory.card.tiktok.private')}
        </Badge>
      )}
      {/* TikTok gates going live behind a follower count, so this is the one badge here that cannot be bought back later. */}
      {tt.canStream && (
        <Badge tone="ok" icon={<Radio size={12} />} title={t('inventory.card.tiktok.streamHint')}>
          {t('inventory.card.tiktok.stream')}
        </Badge>
      )}
      {tt.hasEmail && (
        <Badge tone="ok" icon={<MailFilledIcon size={12} />}>
          {t('inventory.card.tiktok.email')}
        </Badge>
      )}
      {tt.hasMobile && (
        <Badge tone="ok" icon={<PhoneIcon size={12} />}>
          {t('inventory.card.tiktok.mobile')}
        </Badge>
      )}
      {tt.origin && <Badge icon={<TagIcon size={12} />}>{tt.origin}</Badge>}

      {!compact && (
        <>
          {tt.canStreamStudio && (
            <Badge tone="ok" icon={<Radio size={12} />}>
              {t('inventory.card.tiktok.streamStudio')}
            </Badge>
          )}
          {typeof tt.followingCount === 'number' && (
            <Badge icon={<UserPlusIcon size={12} />}>
              {t('inventory.card.tiktok.following', {
                value: formatCount(tt.followingCount, locale),
              })}
            </Badge>
          )}
          {tt.coins != null && tt.coins > 0 && (
            <Badge icon={<WalletIcon size={12} />}>
              {t('inventory.card.tiktok.coins', { value: formatCount(tt.coins, locale) })}
            </Badge>
          )}
          {/* Where the audience is, not where the account was made — hence its own badge with the wording spelled out. */}
          {tt.topCountry && (
            <Badge
              icon={<CountryFlag code={tt.topCountry} />}
              title={t('inventory.card.tiktok.topCountry')}
            >
              {countryName(tt.topCountry, locale)}
            </Badge>
          )}
          {hasDate(tt.registerDate) && (
            <Badge icon={<CalendarIcon size={12} />}>
              {t('inventory.card.tiktok.registered', {
                date: formatFullDate(tt.registerDate, locale),
              })}
            </Badge>
          )}
        </>
      )}
    </div>
  );
};

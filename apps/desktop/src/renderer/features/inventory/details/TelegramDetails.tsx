import {
  TG_SPAM_FOREVER,
  TG_SPAM_GEO,
  TG_SPAM_NONE,
  TG_SPAM_SKIPPED,
  type TelegramInfo,
} from '@shared-types';
import { Hash, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  KeyIcon,
  ShieldIcon,
  SparkleIcon,
  StarIcon,
  TagIcon,
  UsersIcon,
} from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import {
  formatCount,
  formatFullDate,
  formatLastSeen,
  formatShortDate,
  hasDate,
  isDisplayableDate,
} from '../cardFormat';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** The `telegram_spam_block` ladder, rendered exactly as the market web does. */
const SpamBlockBadge = ({ tg }: { tg: TelegramInfo }) => {
  const { t, i18n } = useTranslation();
  const raw = tg.spamBlock;

  if (raw === null) return null;
  if (raw === TG_SPAM_NONE) {
    return (
      <Badge tone="ok" icon={<CheckIcon size={12} />}>
        {t('inventory.card.telegram.noSpamBlock')}
      </Badge>
    );
  }
  if (raw === TG_SPAM_FOREVER) {
    return (
      <Badge tone="danger" icon={<CrossIcon size={12} />}>
        {t('inventory.card.telegram.spamBlockForever')}
      </Badge>
    );
  }
  if (raw === TG_SPAM_GEO) {
    return (
      <Badge tone="warn" icon={<AlertIcon size={12} />}>
        {t('inventory.card.telegram.spamBlockGeo')}
      </Badge>
    );
  }
  if (raw === TG_SPAM_SKIPPED) {
    return (
      <Badge icon={<AlertIcon size={12} />}>{t('inventory.card.telegram.spamBlockUnknown')}</Badge>
    );
  }
  // Past the sentinels the value is whatever the seller's checker wrote, and it is not always a date.
  if (!Number.isFinite(raw)) {
    return (
      <Badge icon={<AlertIcon size={12} />}>{t('inventory.card.telegram.spamBlockUnknown')}</Badge>
    );
  }
  if (!isDisplayableDate(raw)) {
    return (
      <Badge tone="danger" icon={<CrossIcon size={12} />}>
        {t('inventory.card.telegram.spamBlockForever')}
      </Badge>
    );
  }
  // Anything positive is the unix second the block runs until; once it is in the past the account is clean again.
  if (raw * 1000 <= Date.now()) {
    return (
      <Badge tone="ok" icon={<CheckIcon size={12} />}>
        {t('inventory.card.telegram.spamBlockExpired')}
      </Badge>
    );
  }
  return (
    <Badge tone="danger" icon={<CrossIcon size={12} />}>
      {t('inventory.card.telegram.spamBlockUntil', { date: formatShortDate(raw, i18n.language) })}
    </Badge>
  );
};

export const TelegramDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const tg = item.telegram;
  const locale = i18n.language;
  if (!tg) return null;

  return (
    <div className={s.badges}>
      {tg.premium && (
        <Badge tone="ok" icon={<StarIcon size={12} />}>
          {tg.premiumExpires && isDisplayableDate(tg.premiumExpires)
            ? t('inventory.card.telegram.premiumUntil', {
                date: formatShortDate(tg.premiumExpires, locale),
              })
            : t('inventory.card.telegram.premium')}
        </Badge>
      )}
      <SpamBlockBadge tg={tg} />
      {/* `telegram_password` is a 0/1 flag: it says a 2FA password exists, not what it is. */}
      {tg.passwordSet && (
        <Badge tone="warn" icon={<KeyIcon size={12} />}>
          {t('inventory.card.telegram.passwordSet')}
        </Badge>
      )}
      {tg.origin && <Badge icon={<TagIcon size={12} />}>{tg.origin}</Badge>}
      {/* «77 дней назад» — это последний выход аккаунта в сеть. */}
      {hasDate(tg.lastSeen) && (
        <Badge
          icon={<ClockIcon size={12} />}
          title={t('inventory.card.telegram.lastSeenTitle', {
            date: formatFullDate(tg.lastSeen, locale),
          })}
        >
          {formatLastSeen(tg.lastSeen, t)}
        </Badge>
      )}

      {!compact && (
        <>
          {typeof tg.conversationsCount === 'number' && tg.conversationsCount > 0 && (
            <Badge icon={<MessageSquare size={12} />}>
              {t('inventory.card.telegram.conversations', { count: tg.conversationsCount })}
            </Badge>
          )}
          {typeof tg.chatsCount === 'number' && tg.chatsCount > 0 && (
            <Badge icon={<UsersIcon size={12} />}>
              {t('inventory.card.telegram.chats', { count: tg.chatsCount })}
            </Badge>
          )}
          {typeof tg.channelsCount === 'number' && tg.channelsCount > 0 && (
            <Badge icon={<Hash size={12} />}>
              {t('inventory.card.telegram.channels', { count: tg.channelsCount })}
            </Badge>
          )}
          {typeof tg.adminCount === 'number' && tg.adminCount > 0 && (
            <Badge icon={<ShieldIcon size={12} />}>
              {t('inventory.card.telegram.admin', { count: tg.adminCount })}
            </Badge>
          )}
          {typeof tg.adminSubsCount === 'number' && tg.adminSubsCount > 0 && (
            <Badge
              icon={<ShieldIcon size={12} />}
              title={t('inventory.card.telegram.adminSubsTitle')}
            >
              {t('inventory.card.telegram.adminSubs', {
                value: formatCount(tg.adminSubsCount, locale),
              })}
            </Badge>
          )}
          {typeof tg.contactsCount === 'number' && tg.contactsCount > 0 && (
            <Badge icon={<UsersIcon size={12} />}>
              {t('inventory.card.telegram.contacts', { count: tg.contactsCount })}
            </Badge>
          )}
          {typeof tg.starsCount === 'number' && tg.starsCount > 0 && (
            <Badge icon={<SparkleIcon size={12} />}>
              {t('inventory.card.telegram.stars', { count: formatCount(tg.starsCount, locale) })}
            </Badge>
          )}
        </>
      )}
    </div>
  );
};

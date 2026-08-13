import { CreditCard, Gift, Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertIcon,
  CalendarIcon,
  ChatIcon,
  CheckIcon,
  GlobeIcon,
  PhoneIcon,
  ShieldIcon,
  StarIcon,
  TagIcon,
  UsersIcon,
} from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { formatCount, formatFullDate, formatShortDate, hasDate } from '../cardFormat';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** Market condition phrase ids. */
const BAD_CONDITION = 'spam';

export const DiscordDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const dc = item.discord;
  const locale = i18n.language;
  if (!dc) return null;

  const condition = dc.condition?.toLowerCase() ?? null;

  return (
    <div className={s.badges}>
      {condition && (
        <Badge
          tone={condition === BAD_CONDITION ? 'warn' : 'ok'}
          icon={condition === BAD_CONDITION ? <AlertIcon size={12} /> : <CheckIcon size={12} />}
        >
          {/* The market ships its own wording for the phrase id; ours is only a fallback for a condition we have not translated yet. */}
          {t(`inventory.card.discord.condition.${condition}`, {
            defaultValue: dc.conditionLabel ?? dc.condition ?? '',
          })}
        </Badge>
      )}
      {dc.verified && (
        <Badge tone="ok" icon={<PhoneIcon size={12} />}>
          {t('inventory.card.discord.verified')}
        </Badge>
      )}
      {dc.nitroEndDate !== null && (
        <Badge tone="ok" icon={<StarIcon size={12} />}>
          {t('inventory.card.discord.nitroUntil', {
            tier: dc.nitroTypeLabel ?? t('inventory.card.discord.nitro'),
            date: formatShortDate(dc.nitroEndDate, locale),
          })}
        </Badge>
      )}
      {typeof dc.boosts === 'number' && dc.boosts > 0 && (
        <Badge icon={<Rocket size={12} />}>
          {t('inventory.card.discord.boosts', { count: dc.boosts })}
        </Badge>
      )}
      {dc.billing && (
        <Badge icon={<CreditCard size={12} />}>{t('inventory.card.discord.billing')}</Badge>
      )}
      {typeof dc.gifts === 'number' && dc.gifts > 0 && (
        <Badge tone="ok" icon={<Gift size={12} />}>
          {t('inventory.card.discord.gifts', { count: dc.gifts })}
        </Badge>
      )}
      {dc.origin && <Badge icon={<TagIcon size={12} />}>{dc.origin}</Badge>}

      {!compact && (
        <>
          {typeof dc.chatCount === 'number' && dc.chatCount > 0 && (
            <Badge icon={<ChatIcon size={12} />}>
              {t('inventory.card.discord.chats', { count: dc.chatCount })}
            </Badge>
          )}
          {typeof dc.adminServersCount === 'number' && dc.adminServersCount > 0 && (
            <Badge icon={<ShieldIcon size={12} />}>
              {t('inventory.card.discord.adminServers', { count: dc.adminServersCount })}
            </Badge>
          )}
          {typeof dc.adminMembersCount === 'number' && dc.adminMembersCount > 0 && (
            <Badge
              icon={<UsersIcon size={12} />}
              title={t('inventory.card.discord.adminMembersTitle')}
            >
              {t('inventory.card.discord.adminMembers', {
                value: formatCount(dc.adminMembersCount, locale),
              })}
            </Badge>
          )}
          {/* The market has no country for Discord — the locale is the only hint at where the account lives. */}
          {(dc.localeTitle ?? dc.locale) && (
            <Badge icon={<GlobeIcon size={12} />}>
              {t('inventory.card.discord.locale', { locale: dc.localeTitle ?? dc.locale })}
            </Badge>
          )}
          {hasDate(dc.registerDate) && (
            <Badge icon={<CalendarIcon size={12} />}>
              {t('inventory.card.discord.registered', {
                date: formatFullDate(dc.registerDate, locale),
              })}
            </Badge>
          )}
        </>
      )}
    </div>
  );
};

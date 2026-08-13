import { Gift, Globe, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import {
  BoxIcon,
  CalendarIcon,
  CartIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  GamepadIcon,
  LockIcon,
  SparkleIcon,
  StarIcon,
  TagIcon,
  UsersIcon,
  WalletIcon,
} from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import {
  daysSince,
  formatCount,
  formatFullDate,
  formatHours,
  formatLastSeen,
  formatMinorUnits,
  hasDate,
} from '../cardFormat';
import { Badge, MafileBadge } from './Badge';
import type { AccountDetailsProps } from './types';

const STEAM_ICON_BASE = 'https://nztcdn.com/steam/icon';

/** Minor units below this are noise (a few kopecks of change left in the wallet). */
const MONEY_FLOOR = 1000;

/** Above this many hours in the last two weeks the account is clearly live. */
const RECENT_HOURS_WARN = 10;

/** `compact` is table mode: the row has one line, so only the badges that drive a buying decision survive — bans. */
export const SteamDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const steam = item.steam;
  const locale = i18n.language;

  // A locally added Steam account carries no `SteamInfo` at all.
  if (!steam) {
    if (item.category !== 'steam' || item.hasMafile === null) return null;
    return (
      <div className={s.badges}>
        <MafileBadge present={item.hasMafile} />
      </div>
    );
  }

  const banned = steam.vacBanned || steam.communityBanned || steam.tradeBanned;

  return (
    <div className={s.panel}>
      <div className={s.badges}>
        {banned ? (
          <>
            {steam.vacBanned && (
              <Badge tone="danger" icon={<CrossIcon size={12} />}>
                {steam.vacCount && steam.vacCount > 1
                  ? t('inventory.card.steam.banVacCount', { count: steam.vacCount })
                  : t('inventory.card.steam.banVac')}
              </Badge>
            )}
            {steam.communityBanned && (
              <Badge tone="danger" icon={<CrossIcon size={12} />}>
                {t('inventory.card.steam.banCommunity')}
              </Badge>
            )}
            {steam.tradeBanned && (
              <Badge tone="danger" icon={<CrossIcon size={12} />}>
                {t('inventory.card.steam.banTrade')}
              </Badge>
            )}
          </>
        ) : (
          <Badge tone="ok" icon={<CheckIcon size={12} />}>
            {t('inventory.card.steam.noBan')}
          </Badge>
        )}
        {steam.cs2BanActive && (
          <Badge tone="danger" icon={<CrossIcon size={12} />}>
            {steam.cs2BanDate
              ? t('inventory.card.steam.cs2BanUntil', {
                  date: formatFullDate(steam.cs2BanDate, locale),
                })
              : t('inventory.card.steam.cs2Ban')}
          </Badge>
        )}
        {steam.marketBanEndsAt !== null && steam.marketBanEndsAt * 1000 > Date.now() && (
          <Badge tone="warn" icon={<CrossIcon size={12} />}>
            {t('inventory.card.steam.marketBanUntil', {
              date: formatFullDate(steam.marketBanEndsAt, locale),
            })}
          </Badge>
        )}
        {steam.chineseAccount && (
          <Badge tone="warn" icon={<Globe size={12} />}>
            {t('inventory.card.steam.chinese')}
          </Badge>
        )}
        {steam.isLimited && (
          <Badge tone="warn" icon={<LockIcon size={12} />}>
            {steam.limitSpent && steam.limitSpent > 0
              ? t('inventory.card.steam.limitedSpent', {
                  amount: formatMinorUnits(steam.limitSpent, locale),
                })
              : t('inventory.card.steam.limited')}
          </Badge>
        )}
        {item.hasMafile !== null && <MafileBadge present={item.hasMafile} />}
        {typeof steam.level === 'number' && steam.level > 0 && (
          <Badge icon={<StarIcon size={12} />} title={t('inventory.card.steam.levelTitle')}>
            {formatCount(steam.level, locale)}
          </Badge>
        )}
        {typeof steam.gameCount === 'number' && steam.gameCount > 0 && (
          <Badge icon={<GamepadIcon size={12} />}>
            {t('inventory.card.steam.games', { count: steam.gameCount })}
          </Badge>
        )}
        {typeof steam.hoursRecent === 'number' && steam.hoursRecent > 0 && (
          <Badge
            tone={steam.hoursRecent > RECENT_HOURS_WARN ? 'warn' : 'neutral'}
            icon={<ClockIcon size={12} />}
            title={t('inventory.card.steam.hoursRecentTitle')}
          >
            {t('inventory.card.steam.hoursRecent', {
              hours: formatHours(steam.hoursRecent, locale),
            })}
          </Badge>
        )}
        {hasDate(steam.lastActivity) && (
          <Badge icon={<ClockIcon size={12} />} title={t('inventory.card.steam.lastActivityTitle')}>
            {formatLastSeen(steam.lastActivity, t)}
          </Badge>
        )}
        {steam.origin && <Badge icon={<TagIcon size={12} />}>{steam.origin}</Badge>}

        {!compact && (
          <>
            {typeof steam.faceitLevel === 'number' && steam.faceitLevel > 0 && (
              <Badge icon={<Trophy size={12} />}>
                {t('inventory.card.steam.faceit', { level: steam.faceitLevel })}
              </Badge>
            )}
            {typeof steam.convertedBalance === 'number' && steam.convertedBalance > MONEY_FLOOR ? (
              <Badge tone="ok" icon={<WalletIcon size={12} />}>
                {t('inventory.card.steam.balance', {
                  amount: formatMinorUnits(steam.convertedBalance, locale),
                })}
              </Badge>
            ) : (
              steam.balance && (
                <Badge icon={<WalletIcon size={12} />}>
                  {t('inventory.card.steam.balance', { amount: steam.balance })}
                </Badge>
              )
            )}
            {typeof steam.inventoryValue === 'number' && steam.inventoryValue > MONEY_FLOOR && (
              <Badge icon={<BoxIcon size={12} />}>
                {t('inventory.card.steam.inventoryValue', {
                  amount: formatMinorUnits(steam.inventoryValue, locale),
                })}
              </Badge>
            )}
            {typeof steam.giftCount === 'number' && steam.giftCount > 0 && (
              <Badge icon={<Gift size={12} />}>
                {t('inventory.card.steam.gifts', { count: steam.giftCount })}
              </Badge>
            )}
            {typeof steam.friendCount === 'number' && steam.friendCount > 0 && (
              <Badge icon={<UsersIcon size={12} />}>
                {t('inventory.card.steam.friends', { count: steam.friendCount })}
              </Badge>
            )}
            {typeof steam.points === 'number' && steam.points > 0 && (
              <Badge icon={<SparkleIcon size={12} />}>
                {t('inventory.card.steam.points', { points: formatCount(steam.points, locale) })}
              </Badge>
            )}
            {hasDate(steam.lastTransaction) && (
              <Badge
                icon={<CartIcon size={12} />}
                title={t('inventory.card.steam.lastTransactionTitle')}
              >
                {t('inventory.card.steam.lastTransaction', {
                  date: formatFullDate(steam.lastTransaction, locale),
                })}
              </Badge>
            )}
            {hasDate(steam.registerDate) && (
              <Badge
                icon={<CalendarIcon size={12} />}
                title={t('inventory.card.steam.registeredTitle')}
              >
                {t('inventory.card.steam.registered', {
                  date: formatFullDate(steam.registerDate, locale),
                  years: Math.floor(daysSince(steam.registerDate) / 365),
                })}
              </Badge>
            )}
          </>
        )}
      </div>

      {!compact && steam.games.length > 0 && (
        <ul className={s.games}>
          {steam.games.map((g) => (
            <Tooltip
              key={g.appId}
              label={`${g.title} · ${formatHours(g.hours, locale)} ${t('inventory.card.steam.hoursShort')}`}
            >
              <li className={s.game}>
                <img
                  className={s.gameIcon}
                  src={`${STEAM_ICON_BASE}/${g.parentGameId}.webp`}
                  alt=""
                  loading="lazy"
                />
                <span className={s.gameHours}>
                  {formatHours(g.hours, locale)} {t('inventory.card.steam.hoursShort')}
                </span>
              </li>
            </Tooltip>
          ))}
        </ul>
      )}
    </div>
  );
};

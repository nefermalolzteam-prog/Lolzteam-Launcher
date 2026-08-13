import { llmPlanLabel } from '@shared-types';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CalendarIcon,
  CheckIcon,
  CookieIcon,
  GaugeIcon,
  PhoneIcon,
  ShieldIcon,
  SparkleIcon,
  WalletIcon,
} from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { formatFullDate, formatShortDate, hasDate, isDisplayableDate } from '../cardFormat';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** Above this share of the quota the number stops being trivia and starts being the reason the account is cheap. */
const USAGE_WARN_PERCENT = 40;

/** What a category-6 listing says about itself. */
export const LlmDetails = ({ item, compact }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const llm = item.llm;
  const locale = i18n.language;
  if (!llm) return null;

  const plan = llmPlanLabel(item.llmService, llm.subscription);
  // A plan that ran out is the one thing on this card worth colouring: the listing still names the tier.
  const expired =
    hasDate(llm.subscriptionEnds) &&
    isDisplayableDate(llm.subscriptionEnds) &&
    llm.subscriptionEnds * 1000 < Date.now();

  return (
    <div className={s.badges}>
      {plan && (
        <Badge
          tone={expired ? 'warn' : 'ok'}
          icon={<SparkleIcon size={12} />}
          title={
            hasDate(llm.subscriptionEnds)
              ? t(expired ? 'inventory.card.llm.planEndedTitle' : 'inventory.card.llm.planUntil', {
                  date: formatFullDate(llm.subscriptionEnds, locale),
                })
              : undefined
          }
        >
          {hasDate(llm.subscriptionEnds)
            ? t(expired ? 'inventory.card.llm.planEnded' : 'inventory.card.llm.planShort', {
                plan,
                date: formatShortDate(llm.subscriptionEnds, locale),
              })
            : plan}
        </Badge>
      )}
      {/* Only when it renews. */}
      {llm.subscriptionAutoRenew && !expired && (
        <Badge icon={<RefreshCw size={12} />} title={t('inventory.card.llm.autoRenewTitle')}>
          {t('inventory.card.llm.autoRenew')}
        </Badge>
      )}
      {llm.usagePercent !== null && (
        <Badge
          tone={llm.usagePercent >= USAGE_WARN_PERCENT ? 'warn' : 'neutral'}
          icon={<GaugeIcon size={12} />}
          title={t('inventory.card.llm.usageTitle')}
        >
          {t('inventory.card.llm.usage', { value: Math.round(llm.usagePercent) })}
        </Badge>
      )}
      {llm.balance && (
        <Badge
          tone="ok"
          icon={<WalletIcon size={12} />}
          title={t('inventory.card.llm.balanceTitle')}
        >
          {t('inventory.card.llm.balance', { value: llm.balance })}
        </Badge>
      )}

      {!compact && (
        <>
          {/* Tri-state on purpose: `null` is «this provider runs no such check» and gets no badge at all. */}
          {llm.kycVerified !== null && (
            <Badge
              tone={llm.kycVerified ? 'ok' : 'neutral'}
              icon={llm.kycVerified ? <CheckIcon size={12} /> : <ShieldIcon size={12} />}
            >
              {t(llm.kycVerified ? 'inventory.card.llm.kycYes' : 'inventory.card.llm.kycNo')}
            </Badge>
          )}
          {/* Tri-state as well, and read the same way: only ChatGPT listings say anything here. */}
          {llm.hasPhone && (
            <Badge icon={<PhoneIcon size={12} />} title={t('inventory.card.llm.phoneTitle')}>
              {t('inventory.card.llm.phone')}
            </Badge>
          )}
          {llm.hasCookies && (
            <Badge icon={<CookieIcon size={12} />} title={t('inventory.card.llm.cookiesTitle')}>
              {t('inventory.card.llm.cookies')}
            </Badge>
          )}
          {hasDate(llm.registerDate) && (
            <Badge icon={<CalendarIcon size={12} />}>
              {t('inventory.card.llm.registered', {
                date: formatFullDate(llm.registerDate, locale),
              })}
            </Badge>
          )}
        </>
      )}
    </div>
  );
};

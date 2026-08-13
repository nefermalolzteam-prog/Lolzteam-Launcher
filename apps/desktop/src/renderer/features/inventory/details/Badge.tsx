import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { titleWhenClipped } from '~/lib/clippedTitle';
import { Flag } from '~/widgets/Flag/Flag';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { KeyIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'frozen';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  ok: s.badgeOk ?? '',
  warn: s.badgeWarn ?? '',
  danger: s.badgeDanger ?? '',
  // A fifth colour, and only one badge ever wears it.
  frozen: s.badgeFrozen ?? '',
};

/** One pill in a card's badge strip. */
export const Badge = ({
  tone = 'neutral',
  icon,
  title,
  onClick,
  children,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  /** Spelled-out wording, shown on hover for badges whose label is a shorthand. */
  title?: string;
  /** Set when the badge does something, which almost none of them do — a badge is a fact about the account. */
  onClick?: () => void;
  children: ReactNode;
}) => {
  const inner = (
    <>
      {icon}
      {/* Nothing to add when the badge already carries the spelled-out `title`. */}
      <span className={s.badgeLabel} onPointerEnter={title ? undefined : titleWhenClipped}>
        {children}
      </span>
    </>
  );
  const className = `${s.badge} ${TONE_CLASS[tone]}`;
  const pill = onClick ? (
    <button type="button" className={`${className} ${s.badgeButton}`} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <span className={className}>{inner}</span>
  );
  return title ? <Tooltip label={title}>{pill}</Tooltip> : pill;
};

export const CountryFlag = ({ code }: { code: string }) => <Flag code={code} className={s.flag} />;

/** Whether a Steam Guard maFile is on file. */
export const MafileBadge = ({ present }: { present: boolean }) => {
  const { t } = useTranslation();
  return (
    <Badge tone={present ? 'ok' : 'warn'} icon={<KeyIcon size={12} />}>
      {t(present ? 'inventory.card.steam.mafileYes' : 'inventory.card.steam.mafileNo')}
    </Badge>
  );
};

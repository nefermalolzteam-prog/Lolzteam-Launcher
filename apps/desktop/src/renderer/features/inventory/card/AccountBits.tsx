import { Check, Tag } from 'lucide-react';
import s from '../AccountCard.module.scss';
import { AvatarPreview } from '../AvatarPreview';
import { InitialsAvatar } from '../InitialsAvatar';
import { DETAILS_PANELS } from '../details/registry';
import type { AccountFacts } from './facts';

/** The face: a real avatar, initials, the service logo, or nothing at all — in that order, and the order is the point. */
export const AccountThumb = ({
  facts,
  compact,
}: {
  facts: AccountFacts;
  /** The row's sizes and class names rather than the card's. */
  compact: boolean;
}) => {
  const { avatar, initialsName, initialsSeed, thumbSrc } = facts;
  const logoClass = compact ? s.rowLogo : s.logo;
  if (avatar) {
    return (
      <AvatarPreview src={avatar}>
        <img
          className={`${logoClass} ${compact ? s.rowAvatar : s.logoAvatar}`}
          src={avatar}
          alt=""
        />
      </AvatarPreview>
    );
  }
  if (initialsName) {
    return <InitialsAvatar name={initialsName} seed={initialsSeed} size={compact ? 24 : 20} />;
  }
  if (thumbSrc) return <img className={logoClass} src={thumbSrc} alt="" />;
  return <Tag size={20} />;
};

/** The tick, identical in both layouts. */
export const SelectCheck = ({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    aria-label={label}
    className={`${s.selectCheck} ${selected ? s.selectCheckOn : ''}`}
    onClick={onSelect}
  >
    {selected && <Check size={12} strokeWidth={3} />}
  </button>
);

/** Everything the market parsed out of this account. */
export const AccountDetails = ({ facts, compact }: { facts: AccountFacts; compact: boolean }) => (
  <>
    {DETAILS_PANELS.map(({ id, Panel }) => (
      <Panel key={id} item={facts.item} compact={compact} />
    ))}
  </>
);

import type { AccountSummary } from '@shared-types';
import type { AnimationEvent } from 'react';
import { memo } from 'react';
import { useInventoryReveal } from '~/stores/inventoryReveal';
import s from './AccountCard.module.scss';
import { AccountModals } from './card/AccountModals';
import { AccountRow } from './card/AccountRow';
import { AccountTile } from './card/AccountTile';
import { useAccountControls } from './card/controls';
import { useAccountFacts } from './card/facts';

/** One account, in whichever shape the list is currently drawing. */
interface AccountCardProps {
  item: AccountSummary;
  /** Present only for local accounts — the market has no editing here. */
  onEdit?: (item: AccountSummary) => void;
  onDelete?: (item: AccountSummary) => void;
  /** 1-based position in the list, shown in the leading column of a table row. */
  index?: number;
  /** Selection mode. A table row grows a checkbox in its leading column. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (item: AccountSummary) => void;
  /** Table mode: the same account rendered as a row. */
  asRow?: boolean;
}

const AccountCardImpl = ({
  item,
  onEdit,
  onDelete,
  index,
  selectable = false,
  selected = false,
  onSelect,
  asRow = false,
}: AccountCardProps) => {
  const facts = useAccountFacts(item);
  const controls = useAccountControls(facts);
  const Shape = asRow ? AccountRow : AccountTile;

  /** Про эту ли карточку спросили — и, если да, каким по счёту запросом. */
  const revealNonce = useInventoryReveal((st) => (st.itemId === item.itemId ? st.nonce : 0));

  /** Вспышка кончилась — запроса больше нет. */
  const onFlashEnd = (e: AnimationEvent<HTMLElement>): void => {
    if (e.target === e.currentTarget) useInventoryReveal.getState().clear();
  };

  return (
    <article
      className={`${asRow ? s.row : s.card} ${selectable ? s.cardSelectable : ''} ${selected ? s.cardSelected : ''} ${revealNonce > 0 ? s.cardRevealed : ''}`}
      onAnimationEnd={revealNonce > 0 ? onFlashEnd : undefined}
    >
      <Shape
        facts={facts}
        controls={controls}
        index={index}
        selectable={selectable}
        selected={selected}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <AccountModals facts={facts} controls={controls} />
    </article>
  );
};

export const AccountCard = memo(AccountCardImpl);

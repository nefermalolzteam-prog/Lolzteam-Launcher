import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { titleWhenClipped } from '~/lib/clippedTitle';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { StarIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { CountryFlag } from '../details/Badge';
import { AccountActions } from './AccountActions';
import { AccountDetails, AccountThumb, SelectCheck } from './AccountBits';
import type { AccountShapeProps } from './shape';

/** The account as one line of a table. */
export const AccountRow = ({
  facts,
  controls,
  index,
  selectable,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: AccountShapeProps) => {
  const { t } = useTranslation();
  const { item, profile, identity, country, countryText, chipTags, purchased, price } = facts;
  // Green is the unmarked case, so only the other two carry a modifier.
  const statusClass =
    facts.validity === 'invalid'
      ? s.rowStatusInvalid
      : facts.validity === 'unknown'
        ? s.rowStatusUnknown
        : '';
  // Метки — единственная ячейка, у которой два состояния и два имени: пока их нет, кнопка их заводит, а не правит.
  const hasTags = chipTags.length > 0;
  const labelsHint = hasTags ? t('inventory.card.labelsEdit') : t('inventory.card.labelsAdd');

  return (
    <>
      {/* The leading column is the checkbox for every account a mass run can reach. */}
      <div className={s.cellSelect}>
        {selectable ? (
          <SelectCheck label={item.title} selected={selected} onSelect={() => onSelect?.(item)} />
        ) : (
          <span className={s.rowIndex}>{index ?? ''}</span>
        )}
      </div>

      <div className={s.cellAccount}>
        <AccountThumb facts={facts} compact />
        <div className={s.rowTitles}>
          <span className={s.rowTitle}>
            <span className={s.rowTitleText} title={item.title}>
              {item.title}
            </span>
            {profile?.premium && (
              <StarIcon size={11} className={s.premiumMark} aria-label="Premium" />
            )}
          </span>
          {/* The second line, and only what the row cannot say twice. */}
          {identity && (
            <span className={s.rowIdentity} onPointerEnter={titleWhenClipped}>
              {identity}
            </span>
          )}
          {country && (
            <span className={s.rowSub}>
              <CountryFlag code={country} />
              {/* Long ones («Южно-Африканская Республика») are cut by the column and get the full name on hover — see `titleWhenClipped`. */}
              <span onPointerEnter={titleWhenClipped}>{countryText}</span>
            </span>
          )}
        </div>
      </div>

      {/* The market's word on the item and nothing else. */}
      <div className={s.cellStatus}>
        <span className={`${s.rowStatus} ${statusClass}`}>
          <span className={s.dot} />
          {facts.statusText}
        </span>
      </div>

      {/* Метки и информация — одна ячейка и одна строка фишек. */}
      <div className={s.cellFacts}>
        {/* What the button does, whatever is in it. */}
        <Tooltip label={labelsHint}>
          <button
            type="button"
            className={`${s.labelsEdit} ${hasTags ? '' : s.labelsAdd}`}
            onClick={controls.openLabels}
            aria-label={labelsHint}
          >
            {hasTags ? (
              chipTags.map((tag) => {
                const c = facts.colorForTag(tag);
                return (
                  <span
                    key={tag.id}
                    className={s.rowTag}
                    style={{ backgroundColor: c.background, color: c.text }}
                  >
                    {tag.title}
                  </span>
                );
              })
            ) : (
              <Plus size={14} strokeWidth={2} />
            )}
          </button>
        </Tooltip>
        <AccountDetails facts={facts} compact />
      </div>

      <div className={`${s.cellText} ${s.cellPurchased} ${purchased ? '' : s.cellEmpty}`}>
        {purchased ?? t('inventory.card.none')}
      </div>
      <div className={`${s.cellText} ${s.cellRight} ${s.cellMarket}`}>{price}</div>
      <div className={s.cellActions}>
        <AccountActions
          facts={facts}
          controls={controls}
          compact
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </>
  );
};

import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { NoteIcon, StarIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { CountryFlag } from '../details/Badge';
import { AccountActions } from './AccountActions';
import { AccountDetails, AccountThumb, SelectCheck } from './AccountBits';
import type { AccountShapeProps } from './shape';

/** The account as a card: the shape the grid draws. */
export const AccountTile = ({
  facts,
  controls,
  selectable,
  selected,
  onSelect,
  onEdit,
  onDelete,
}: AccountShapeProps) => {
  const { t } = useTranslation();
  const { item, isLocal, profile, identity, country, countryText, chipTags } = facts;
  // Green is the unmarked case, so only the other two carry a modifier — see the note in `AccountRow`.
  const statusClass =
    facts.validity === 'invalid'
      ? s.statusInvalid
      : facts.validity === 'unknown'
        ? s.statusUnknown
        : '';

  const aboutParts: ReactNode[] = [];
  if (identity) {
    aboutParts.push(
      <span key="identity" className={s.identity}>
        {identity}
      </span>,
    );
  }
  if (country) {
    aboutParts.push(
      <span key="country" className={s.country}>
        <CountryFlag code={country} /> {countryText}
      </span>,
    );
  }

  return (
    <>
      <div className={s.topSection}>
        <header className={s.head}>
          <div className={s.thumbBlock}>
            <AccountThumb facts={facts} compact={false} />
            <span className={s.category}>{facts.categoryText}</span>
            {profile?.premium && (
              <span className={s.premiumTag} title="Telegram Premium">
                <StarIcon size={11} />
              </span>
            )}
          </div>
          <div className={s.headRight}>
            <div className={`${s.status} ${statusClass}`}>
              <span className={s.dot} />
              <h3 className={s.text}>{facts.statusText}</h3>
            </div>
            {selectable && (
              <SelectCheck
                label={item.title}
                selected={selected}
                onSelect={() => onSelect?.(item)}
              />
            )}
          </div>
        </header>

        <h3 className={s.titleAccount}>{item.title}</h3>

        {aboutParts.length > 0 && (
          <div className={s.aboutBlock}>
            {aboutParts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && <span className={s.dot} />}
                {part}
              </Fragment>
            ))}
          </div>
        )}

        {/* What is known about the account and what the user called it, as one block: the two are read together. */}
        <div className={s.factsBlock}>
          <div className={s.parsedInfo}>
            <AccountDetails facts={facts} compact={false} />
          </div>

          {chipTags.length > 0 && (
            // The same control as the row's labels cell.
            <Tooltip label={t('inventory.card.labelsEdit')}>
              <button
                type="button"
                className={s.tagsBlock}
                onClick={controls.openLabels}
                aria-label={t('inventory.card.labelsEdit')}
              >
                {chipTags.map((tag) => {
                  const c = facts.colorForTag(tag);
                  return (
                    <span
                      key={tag.id}
                      className={s.tagsItem}
                      style={{ backgroundColor: c.background, color: c.text }}
                    >
                      {tag.title}
                    </span>
                  );
                })}
              </button>
            </Tooltip>
          )}

          {/* The note itself, on the card, clamped to two lines: it is the user's own sentence about this account. */}
          {item.note && (
            <Tooltip label={t('inventory.card.note.menuEdit')}>
              <button
                type="button"
                className={s.noteBlock}
                onClick={controls.openNote}
                aria-label={t('inventory.card.note.menuEdit')}
              >
                <NoteIcon size={13} className={s.noteIcon} />
                <span className={s.noteText}>{item.note}</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className={s.bottomBlock}>
        <span className={s.divider} />

        <div className={s.bottomGroup}>
          {facts.purchased && (
            <div className={s.bottomItem}>
              <span className={s.description}>
                {t(isLocal ? 'inventory.card.addedLabel' : 'inventory.card.purchasedLabel')}
              </span>
              <span className={s.title}>{facts.purchased}</span>
            </div>
          )}
          {facts.warranty && (
            <div className={s.bottomItem}>
              <span className={s.description}>{t('inventory.card.warrantyLabel')}</span>
              <span className={s.title}>{facts.warranty}</span>
            </div>
          )}
          {!isLocal && (
            <div className={s.bottomItem}>
              <span className={s.description}>{t('inventory.card.priceLabel')}</span>
              <span className={s.title}>{facts.price}</span>
            </div>
          )}
        </div>
        <div className={s.buttonGroup}>
          <AccountActions
            facts={facts}
            controls={controls}
            compact={false}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </div>
    </>
  );
};

import type { ItemEditFields, ItemOrigin } from '@shared-types';
import { originsForCategory } from '@shared-types';
import type { AccountSummary } from '@shared-types';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalChip,
  ModalChips,
  ModalError,
  ModalField,
  ModalGroup,
  ModalHint,
  ModalInput,
  ModalSpacer,
  ModalTextarea,
} from '~/widgets/Modal/ModalKit';

interface ListingEditModalProps {
  item: AccountSummary;
  onClose: () => void;
  /** The market took the price — this is what the lot costs now. */
  onSaved: (price: number | null) => void;
}

/** `''` and anything unparsable stay the dialog's business; the market only ever sees a whole positive number. */
const parsePrice = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** «keep» is for a field the market did not report: leave whatever is there. */
type Tri = 'keep' | 'yes' | 'no';

const triOf = (value: boolean | null | undefined): Tri =>
  value === null || value === undefined ? 'keep' : value ? 'yes' : 'no';

/**
 * The seller's own listing, in one form. `Managing.Edit` keeps every field the
 * request leaves out, so the dialog sends only what was actually changed, and
 * starts each field on its current value. «Не менять» is offered only where the
 * market reported nothing back — private information, which is write-only, has
 * no current value at all and so is always blank.
 */
export const ListingEditModal = ({ item, onClose, onSaved }: ListingEditModalProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item.title);
  const [titleEn, setTitleEn] = useState(item.listing?.titleEn ?? '');
  const [priceText, setPriceText] = useState(String(item.price));
  const [description, setDescription] = useState(item.description);
  const [information, setInformation] = useState('');
  // Known values start selected; only what the market left unsaid starts on «keep».
  const known = item.listing;
  const discountNow = triOf(known?.allowAskDiscount);
  const [discount, setDiscount] = useState<Tri>(discountNow);
  const [origin, setOrigin] = useState<ItemOrigin | null>(known?.origin ?? null);
  // Not every origin fits every category, and the market refuses the ones that do not.
  const origins = originsForCategory(item.categoryRaw, known?.origin ?? null);
  const [emailType, setEmailType] = useState<'native' | 'autoreg' | null>(known?.emailType ?? null);

  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggested, setSuggested] = useState<{ ai?: number | null; auto?: number | null }>({});
  const [error, setError] = useState<string | null>(null);

  const price = parsePrice(priceText);

  /** Only what the user actually moved — everything else keeps its market value. */
  const changed = (): ItemEditFields => {
    const fields: ItemEditFields = {};
    if (title.trim() && title !== item.title) fields.title = title.trim();
    if (titleEn.trim() && titleEn.trim() !== (known?.titleEn ?? '')) {
      fields.title_en = titleEn.trim();
    }
    if (price !== null && Math.round(price) !== item.price) {
      fields.price = Math.round(price);
      fields.currency = item.currency;
    }
    if (description !== item.description) fields.description = description;
    if (information.trim()) fields.information = information;
    if (discount !== 'keep' && discount !== discountNow) {
      fields.allow_ask_discount = discount === 'yes';
    }
    if (origin && origin !== (known?.origin ?? null)) fields.item_origin = origin;
    if (emailType && emailType !== (known?.emailType ?? null)) fields.email_type = emailType;
    return fields;
  };

  const dirty = Object.keys(changed()).length > 0;

  const suggest = async (kind: 'ai' | 'auto'): Promise<void> => {
    if (aiBusy) return;
    setAiBusy(true);
    setError(null);
    try {
      const res =
        kind === 'ai'
          ? await window.launcher.accounts.aiListingPrice(item.itemId)
          : await window.launcher.accounts.autoBuyPrice(item.itemId);
      if (res.ok) {
        setSuggested((s) => ({ ...s, [kind]: res.price ?? null }));
        if (res.price) setPriceText(String(res.price));
      } else {
        setError(t('inventory.card.listing.aiFailed'));
      }
    } catch {
      setError(t('inventory.card.listing.aiFailed'));
    } finally {
      setAiBusy(false);
    }
  };

  const commit = async (): Promise<void> => {
    const fields = changed();
    if (busy || Object.keys(fields).length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.launcher.accounts.listingOp(item.itemId, { kind: 'edit', fields });
      if (res.ok) {
        onSaved(fields.price ?? null);
        onClose();
        return;
      }
      setError(
        res.message
          ? t(res.message.key, res.message.params)
          : t('inventory.card.listing.saveFailed'),
      );
    } catch {
      setError(t('inventory.card.listing.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const tri = (value: Tri, set: (v: Tri) => void, unknown: boolean) => (
    <ModalChips>
      {(unknown ? (['keep', 'yes', 'no'] as const) : (['yes', 'no'] as const)).map((v) => (
        <ModalChip
          key={v}
          label={t(`inventory.card.listing.tri.${v}`)}
          selected={value === v}
          onClick={() => set(v)}
        />
      ))}
    </ModalChips>
  );

  return (
    <Modal
      title={t('inventory.card.listing.editTitle')}
      subtitle={item.title}
      size="xl"
      closable
      onClose={onClose}
      footer={
        <>
          <ModalSpacer />
          <Button variant="dangerSoft" size="sm" disabled={busy} onClick={onClose}>
            {t('inventory.local.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={!dirty}
            onClick={() => void commit()}
          >
            {t('inventory.local.save')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>

      <ModalField label={t('inventory.card.listing.titleLabel')}>
        <ModalInput value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      </ModalField>

      <ModalField
        label={t('inventory.card.listing.titleEnLabel')}
        note={t('inventory.card.listing.titleEnHint')}
      >
        <ModalInput value={titleEn} disabled={busy} onChange={(e) => setTitleEn(e.target.value)} />
      </ModalField>

      <ModalField label={t('inventory.card.listing.priceLabel', { currency: item.currency })}>
        <ModalInput
          type="text"
          inputMode="decimal"
          value={priceText}
          disabled={busy}
          onChange={(e) => setPriceText(e.target.value)}
        />
      </ModalField>
      <ModalChips>
        <ModalChip
          icon={Sparkles}
          label={t('inventory.card.listing.aiButton')}
          onClick={() => void suggest('ai')}
        />
        <ModalChip
          label={t('inventory.card.listing.autoBuyButton')}
          onClick={() => void suggest('auto')}
        />
      </ModalChips>
      {suggested.ai !== undefined && (
        <ModalHint>
          {suggested.ai === null
            ? t('inventory.card.listing.aiNone')
            : t('inventory.card.listing.aiHint', {
                price: suggested.ai,
                currency: item.currency,
              })}
        </ModalHint>
      )}
      {suggested.auto !== undefined && (
        <ModalHint>
          {suggested.auto === null
            ? t('inventory.card.listing.autoBuyNone')
            : t('inventory.card.listing.autoBuyHint', {
                price: suggested.auto,
                currency: item.currency,
              })}
        </ModalHint>
      )}

      <ModalField label={t('inventory.card.listing.descriptionLabel')}>
        <ModalTextarea
          rows={3}
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </ModalField>

      <ModalField
        label={t('inventory.card.listing.informationLabel')}
        note={t('inventory.card.listing.informationHint')}
      >
        <ModalTextarea
          rows={3}
          value={information}
          disabled={busy}
          onChange={(e) => setInformation(e.target.value)}
        />
      </ModalField>

      <ModalGroup>{t('inventory.card.listing.discountLabel')}</ModalGroup>
      {tri(discount, setDiscount, discountNow === 'keep')}

      <ModalGroup>{t('inventory.card.listing.originLabel')}</ModalGroup>
      <ModalChips>
        {!known?.origin && (
          <ModalChip
            label={t('inventory.card.listing.tri.keep')}
            selected={origin === null}
            onClick={() => setOrigin(null)}
          />
        )}
        {origins.map((o) => (
          <ModalChip
            key={o}
            label={t(`inventory.card.listing.origins.${o}`)}
            selected={origin === o}
            onClick={() => setOrigin(origin === o && !known?.origin ? null : o)}
          />
        ))}
      </ModalChips>

      <ModalGroup>{t('inventory.card.listing.emailTypeLabel')}</ModalGroup>
      <ModalChips>
        {!known?.emailType && (
          <ModalChip
            label={t('inventory.card.listing.tri.keep')}
            selected={emailType === null}
            onClick={() => setEmailType(null)}
          />
        )}
        {(['native', 'autoreg'] as const).map((v) => (
          <ModalChip
            key={v}
            label={t(`inventory.card.listing.emailTypes.${v}`)}
            selected={emailType === v}
            onClick={() => setEmailType(emailType === v && !known?.emailType ? null : v)}
          />
        ))}
      </ModalChips>
    </Modal>
  );
};

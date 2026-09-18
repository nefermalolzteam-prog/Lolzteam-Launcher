import type { AccountSummary } from '@shared-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalChip,
  ModalChips,
  ModalError,
  ModalGroup,
  ModalHint,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';

/** The intervals worth one tap; the market itself takes any whole number of hours. */
const PRESETS = [1, 2, 4, 6, 12, 24] as const;

interface ListingAutoBumpModalProps {
  item: AccountSummary;
  onClose: () => void;
  /** The interval the market accepted, or `null` when it was switched off. */
  onSaved: (hours: number | null) => void;
}

/**
 * Auto-bump in one place: what it is set to now, the intervals to change it to,
 * and the way to switch it off — instead of a menu entry per interval.
 */
export const ListingAutoBumpModal = ({ item, onClose, onSaved }: ListingAutoBumpModalProps) => {
  const { t } = useTranslation();
  const current = item.listing?.autoBumpHours ?? null;
  const [hour, setHour] = useState<number | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (off: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.launcher.accounts.listingOp(
        item.itemId,
        off ? { kind: 'auto-bump-off' } : { kind: 'auto-bump', hour: hour ?? 4 },
      );
      if (res.ok) {
        // The badge reads the list, not this dialog — tell it what changed.
        onSaved(off ? null : (hour ?? 4));
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

  return (
    <Modal
      title={t('inventory.card.listing.autoBumpTitle')}
      subtitle={item.title}
      closable
      onClose={onClose}
      footer={
        <>
          {current !== null && (
            <Button variant="dangerSoft" size="sm" disabled={busy} onClick={() => void apply(true)}>
              {t('inventory.card.listing.autoBumpOff')}
            </Button>
          )}
          <ModalSpacer />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t('inventory.local.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={hour === null || hour === current}
            onClick={() => void apply(false)}
          >
            {t('inventory.local.save')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>
        {current === null
          ? t('inventory.card.listing.autoBumpNone')
          : t('inventory.card.listing.autoBumpCurrent', { hour: current })}
      </ModalHint>

      <ModalGroup>{t('inventory.card.listing.autoBumpEveryLabel')}</ModalGroup>
      <ModalChips>
        {PRESETS.map((h) => (
          <ModalChip
            key={h}
            label={t('inventory.card.listing.autoBumpHours', { hour: h })}
            selected={hour === h}
            onClick={() => setHour(h)}
          />
        ))}
      </ModalChips>
    </Modal>
  );
};

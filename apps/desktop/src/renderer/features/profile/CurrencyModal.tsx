import type { AuthStatus, MarketCurrency } from '@shared-types';
import { MARKET_CURRENCIES } from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CURRENCY_FLAG } from '~/lib/flags';
import { clearAccountsCacheAndRestream } from '~/stores/accountsStream';
import { Flag } from '~/widgets/Flag/Flag';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalGrid, ModalOption } from '~/widgets/Modal/ModalKit';
import s from './SelectorModal.module.scss';

interface CurrencyModalProps {
  onClose: () => void;
}

export const CurrencyModal = ({ onClose }: CurrencyModalProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = qc.getQueryData<AuthStatus>(['auth-status']);
  const current = (status?.session?.currency ?? '').toLowerCase();
  const [busy, setBusy] = useState<MarketCurrency | null>(null);
  const [error, setError] = useState<string | null>(null);

  const select = async (currency: MarketCurrency) => {
    if (busy || currency === current) return;
    setBusy(currency);
    setError(null);
    try {
      const res = await window.launcher.profile.setCurrency(currency);
      if (!res.ok) {
        setError(res.message ?? t('settings.currency.failed'));
        return;
      }
      // Profile balance/currency and per-item prices are server-side in the new currency now.
      const next = await window.launcher.auth.getStatus();
      qc.setQueryData(['auth-status'], next);
      await clearAccountsCacheAndRestream(qc);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.currency.failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    // `md`, а не `sm`: в две колонки узкий диалог оставлял под название валюты полсотни точек.
    <Modal title={t('settings.currency.modalTitle')} size="md" closable onClose={onClose}>
      <ModalError>{error}</ModalError>
      <ModalGrid>
        {MARKET_CURRENCIES.map((code) => (
          <ModalOption
            key={code}
            leading={<Flag code={CURRENCY_FLAG[code]} className={s.flag} />}
            title={code.toUpperCase()}
            hint={t(`settings.currency.names.${code}`)}
            selected={current === code}
            busy={busy === code}
            disabled={busy !== null}
            onClick={() => void select(code)}
          />
        ))}
      </ModalGrid>
    </Modal>
  );
};

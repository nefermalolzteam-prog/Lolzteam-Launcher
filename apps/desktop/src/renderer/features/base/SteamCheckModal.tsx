import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalHint, ModalSpacer } from '~/widgets/Modal/ModalKit';
import { ProxySpreadRow, useProxySpread } from './ProxySpreadRow';

interface SteamCheckModalProps {
  count: number;
  /** Set when main refused the run — another one is going, or nothing was left. */
  error: string | null;
  onCancel: () => void;
  onStart: (options: { proxyIds: string[] }) => void;
}

export const SteamCheckModal = ({ count, error, onCancel, onStart }: SteamCheckModalProps) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const proxy = useProxySpread('steam');

  const start = (): void => {
    if (busy) return;
    setBusy(true);
    onStart({ proxyIds: proxy.proxyIds });
  };

  // A refusal unlocks the button again: the modal stays open to say why.
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  return (
    <Modal
      title={t('base.steamCheck.title')}
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('base.check.cancel')}
          </Button>
          <Button variant="accent" size="sm" icon={ShieldCheck} busy={busy} onClick={start}>
            {t('base.check.start')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>{t('base.steamCheck.lead', { count })}</ModalHint>

      <ProxySpreadRow
        state={proxy}
        hint={t('base.steamCheck.spreadHint')}
        noProxy={t('base.steamCheck.noProxy')}
      />

      {/* Последней строкой, а не первой: она про то, чем окажется результат. */}
      <ModalHint>{t('base.steamCheck.volatile')}</ModalHint>
    </Modal>
  );
};

import { PlusCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalHint, ModalSpacer, ModalWarn } from '~/widgets/Modal/ModalKit';
import { ProxySpreadRow, useProxySpread } from './ProxySpreadRow';

interface LinkModalProps {
  count: number;
  /** Set when main refused the run — another one is going, or nothing was left. */
  error: string | null;
  onCancel: () => void;
  onStart: (options: { proxyIds: string[] }) => void;
}

export const LinkModal = ({ count, error, onCancel, onStart }: LinkModalProps) => {
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
      title={t('base.link.title')}
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('base.check.cancel')}
          </Button>
          <Button variant="accent" size="sm" icon={PlusCircle} busy={busy} onClick={start}>
            {t('base.link.start')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>{t('base.link.lead', { count })}</ModalHint>

      {/* Предупреждение — до строки прокси, а не после: прокси выбирают уже зная, что именно поедет через них. */}
      <ModalWarn>{t('base.link.warn')}</ModalWarn>

      <ProxySpreadRow
        state={proxy}
        hint={t('base.link.spreadHint')}
        noProxy={t('base.link.noProxy')}
      />

      <ModalHint>{t('base.link.emailHint')}</ModalHint>
    </Modal>
  );
};

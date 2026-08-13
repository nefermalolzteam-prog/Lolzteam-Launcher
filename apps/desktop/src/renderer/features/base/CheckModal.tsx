import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalCheck,
  ModalChecks,
  ModalError,
  ModalHint,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';
import { ProxySpreadRow, useProxySpread } from './ProxySpreadRow';

interface CheckModalProps {
  count: number;
  /** Set when main refused the run — another one is going, or nothing was left. */
  error: string | null;
  onCancel: () => void;
  onStart: (options: {
    withSpam: boolean;
    withSessions: boolean;
    withAvatar: boolean;
    proxyIds: string[];
  }) => void;
}

export const CheckModal = ({ count, error, onCancel, onStart }: CheckModalProps) => {
  const { t } = useTranslation();
  const [withSpam, setWithSpam] = useState(false);
  const [withSessions, setWithSessions] = useState(false);
  const [withAvatar, setWithAvatar] = useState(true);
  const [busy, setBusy] = useState(false);
  const proxy = useProxySpread('telegram');

  const start = (): void => {
    if (busy) return;
    setBusy(true);
    onStart({
      withSpam,
      withSessions,
      withAvatar,
      proxyIds: proxy.proxyIds,
    });
  };

  // A refusal unlocks the button again: the modal stays open to say why.
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  return (
    <Modal
      title={t('base.check.title')}
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
      <ModalHint>{t('base.check.lead', { count })}</ModalHint>

      <ModalChecks>
        <ModalCheck checked={withAvatar} onChange={setWithAvatar} hint={t('base.check.avatarHint')}>
          {t('base.check.avatar')}
        </ModalCheck>
        <ModalCheck checked={withSpam} onChange={setWithSpam} hint={t('base.check.spamHint')}>
          {t('base.check.spam')}
        </ModalCheck>
        <ModalCheck
          checked={withSessions}
          onChange={setWithSessions}
          hint={t('base.check.sessionsHint')}
        >
          {t('base.check.sessions')}
        </ModalCheck>
      </ModalChecks>

      <ProxySpreadRow
        state={proxy}
        hint={t('base.check.spreadHint')}
        noProxy={t('base.check.noProxy')}
      />
    </Modal>
  );
};

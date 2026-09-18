import type { AccountConfirmKind } from '@shared-ipc';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalSpacer, ModalWarn } from '~/widgets/Modal/ModalKit';

interface PendingConfirm {
  itemId: number;
  kind: AccountConfirmKind;
}

/**
 * The market cancels an item's active guarantee the moment its maFile is
 * downloaded — so that download runs only after this prompt says yes. It is
 * mounted above everything login-related on purpose: the question can come
 * from a login, or from linking the SDA authenticator.
 */
export const AccountConfirmPrompt = () => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    const off = window.launcher.accounts.onConfirmRequest((p) => {
      setPending({ itemId: p.itemId, kind: p.kind });
    });
    return off;
  }, []);

  if (!pending) return null;

  const answer = (accept: boolean) => {
    const item = pending;
    setPending(null);
    void window.launcher.accounts.answerConfirm(item.itemId, item.kind, accept);
  };

  return (
    <Modal
      title={t(`confirm.${pending.kind}.title`)}
      size="sm"
      closable
      onClose={() => answer(false)}
      footer={
        <>
          <Button variant="dangerSoft" size="sm" onClick={() => answer(false)}>
            {t('confirm.decline')}
          </Button>
          <ModalSpacer />
          <Button variant="accent" size="sm" onClick={() => answer(true)}>
            {t(`confirm.${pending.kind}.accept`)}
          </Button>
        </>
      }
    >
      <ModalWarn>{t(`confirm.${pending.kind}.text`)}</ModalWarn>
    </Modal>
  );
};

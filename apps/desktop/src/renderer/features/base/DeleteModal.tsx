import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalHint, ModalSpacer, ModalWarn } from '~/widgets/Modal/ModalKit';

interface DeleteModalProps {
  count: number;
  busy: boolean;
  /** How many of the selected accounts main has already answered for. */
  done: number;
  /** Set when some of them refused to go, already turned into a sentence. */
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteModal = ({
  count,
  busy,
  done,
  error,
  onCancel,
  onConfirm,
}: DeleteModalProps) => {
  const { t } = useTranslation();

  return (
    // No way out while the deletions are going: closing the modal would not stop them.
    <Modal
      title={t('base.delete.title')}
      closable={!busy}
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('base.check.cancel')}
          </Button>
          {/* Пока идёт удаление, счётчик едет на самой кнопке: ряда счётчиков, какой есть у проверки, здесь нет. */}
          <Button variant="danger" size="sm" icon={Trash2} busy={busy} onClick={onConfirm}>
            {busy
              ? t('base.delete.progress', { done, total: count })
              : t('base.delete.confirm', { count })}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>{t('base.delete.lead', { count })}</ModalHint>
      <ModalWarn>{t('base.delete.warn')}</ModalWarn>
    </Modal>
  );
};

import type { LocalAccountEdit, LocalAccountInput } from '@shared-types';
import { useTranslation } from 'react-i18next';
import { Modal } from '~/widgets/Modal/Modal';
import { LocalAccountForm } from './LocalAccountForm';

interface LocalAccountModalProps {
  /** `null` = create; otherwise the non-secret half of an existing record. */
  edit: LocalAccountEdit | null;
  onClose: () => void;
  onSubmit: (input: LocalAccountInput) => Promise<{ ok: boolean; message?: string }>;
}

export const LocalAccountModal = ({ edit, onClose, onSubmit }: LocalAccountModalProps) => {
  const { t } = useTranslation();
  return (
    <Modal
      title={edit ? t('inventory.local.editTitle') : t('inventory.local.addTitle')}
      closable
      onClose={onClose}
    >
      <LocalAccountForm edit={edit} onCancel={onClose} onSubmit={onSubmit} onDone={onClose} />
    </Modal>
  );
};

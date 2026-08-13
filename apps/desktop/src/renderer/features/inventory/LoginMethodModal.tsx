import { AppWindow, Globe } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoginMethod } from '~/stores/loginSession';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalCheck, ModalOption, ModalSpacer } from '~/widgets/Modal/ModalKit';

interface LoginMethodModalProps {
  methods: readonly LoginMethod[];
  onChoose: (method: LoginMethod, remember: boolean) => void;
  onCancel: () => void;
}

export const LoginMethodModal = ({ methods, onChoose, onCancel }: LoginMethodModalProps) => {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);

  return (
    <Modal
      title={t('inventory.card.loginMethod.title')}
      size="sm"
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalCheck checked={remember} onChange={setRemember}>
            {t('inventory.card.loginMethod.remember')}
          </ModalCheck>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('inventory.local.cancel')}
          </Button>
        </>
      }
    >
      {methods.map((m) => (
        <ModalOption
          key={m}
          icon={m === 'web' ? Globe : AppWindow}
          title={t(`inventory.card.loginMethod.${m}`)}
          action="go"
          onClick={() => onChoose(m, remember)}
        />
      ))}
    </Modal>
  );
};

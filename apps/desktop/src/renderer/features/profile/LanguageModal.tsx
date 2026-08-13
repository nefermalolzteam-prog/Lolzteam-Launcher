import type { LocalePreference } from '@shared-types';
import { useTranslation } from 'react-i18next';
import { LOCALE_FLAG } from '~/lib/flags';
import { useSettings } from '~/stores/settings';
import { Flag } from '~/widgets/Flag/Flag';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalGrid, ModalOption } from '~/widgets/Modal/ModalKit';
import s from './SelectorModal.module.scss';

const LOCALE_OPTIONS: readonly LocalePreference[] = ['ru', 'en'] as const;

interface LanguageModalProps {
  onClose: () => void;
}

export const LanguageModal = ({ onClose }: LanguageModalProps) => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const setSettings = useSettings((st) => st.set);
  const current: LocalePreference = settings?.locale ?? 'ru';

  const select = async (locale: LocalePreference) => {
    const next = await window.launcher.settings.set({ locale });
    setSettings(next.settings);
    onClose();
  };

  return (
    <Modal title={t('settings.language.modalTitle')} size="sm" closable onClose={onClose}>
      <ModalGrid>
        {LOCALE_OPTIONS.map((opt) => (
          <ModalOption
            key={opt}
            leading={<Flag code={LOCALE_FLAG[opt]} className={s.flag} />}
            title={t(`settings.language.${opt}`)}
            selected={current === opt}
            onClick={() => void select(opt)}
          />
        ))}
      </ModalGrid>
    </Modal>
  );
};

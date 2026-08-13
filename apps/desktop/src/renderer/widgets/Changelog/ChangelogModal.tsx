import { useTranslation } from 'react-i18next';
import { CHANGELOG } from '~/data/changelog';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalSpacer } from '~/widgets/Modal/ModalKit';
import s from './ChangelogModal.module.scss';

interface ChangelogModalProps {
  currentVersion: string;
  onClose: () => void;
}

const formatDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));

/** Что изменилось в приложении, от новой версии к старым. */
export const ChangelogModal = ({ currentVersion, onClose }: ChangelogModalProps) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'ru' ? 'ru' : 'en';

  return (
    <Modal
      title={t('changelog.title')}
      onClose={onClose}
      closable
      footer={
        <>
          <ModalSpacer />
          <Button variant="accent" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className={s.list}>
        {CHANGELOG.map((entry) => (
          <section key={entry.version} className={s.entry}>
            <header className={s.entryHead}>
              <span className={s.version}>v{entry.version}</span>
              {entry.version === currentVersion && (
                <span className={s.currentTag}>{t('changelog.current')}</span>
              )}
              <span className={s.date}>{formatDate(entry.date, i18n.language)}</span>
            </header>
            <ul className={s.changes}>
              {entry.changes[lang].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
};

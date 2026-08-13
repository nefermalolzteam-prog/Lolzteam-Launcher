import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCountdown } from '~/lib/useCountdown';
import { setDebugFlag, useDebugFlag } from '~/stores/debug';
import { patchSettings, useSettings } from '~/stores/settings';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalHint, ModalSpacer } from '~/widgets/Modal/ModalKit';
import s from './MetricsConsentModal.module.scss';

/** Что уходит на сервер — в том порядке, в каком это стоит читать. */
const FIELDS = ['install', 'version', 'os', 'locale', 'events', 'ip'] as const;

/** Сколько секунд окно не даёт себя закрыть молча. */
const READING_TIME = 5;

/** The question, asked once. */
export const MetricsConsentModal = () => {
  const settings = useSettings((st) => st.settings);
  const [available, setAvailable] = useState<boolean | null>(null);
  /* Показ из Debug Menu. */
  const forced = useDebugFlag('metricsConsent');

  useEffect(() => {
    let alive = true;
    void window.launcher.metrics.state().then((state) => {
      if (alive) setAvailable(state.available);
    });
    return () => {
      alive = false;
    };
  }, []);

  // `null` is «не спрашивали»; `false` is an answer and must never be asked again.
  if (!forced && (available !== true || settings === null || settings.metricsEnabled !== null)) {
    return null;
  }

  return <ConsentDialog forced={forced} />;
};

/** Само окно — отдельным компонентом, потому что отсчёт начинается с его монтирования. */
const ConsentDialog = ({ forced }: { forced: boolean }) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const left = useCountdown(READING_TIME);
  const waiting = left > 0;

  const answer = async (enabled: boolean) => {
    if (busy) return;
    // Открыто, чтобы посмотреть, — значит, и ответ здесь ничего не значит: окно закрывается, настройки остаются с тем ответом.
    if (forced) {
      setDebugFlag('metricsConsent', false);
      return;
    }
    setBusy(true);
    // Through the settings store rather than through `metrics.setEnabled`.
    await patchSettings({ metricsEnabled: enabled });
  };

  return (
    <Modal
      title={t('settings.metrics.consent.title')}
      closable={!busy}
      closeDisabled={waiting}
      onClose={busy ? undefined : () => void answer(false)}
      footer={
        <>
          <ModalSpacer />
          {/* Счёт — в самой кнопке, которая ждёт, а не отдельной строкой рядом: так он объясняет ровно. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || waiting}
            onClick={() => void answer(false)}
          >
            {waiting
              ? t('settings.metrics.consent.declineWait', { seconds: left })
              : t('settings.metrics.consent.decline')}
          </Button>
          <Button variant="accent" size="sm" busy={busy} onClick={() => void answer(true)}>
            {t('settings.metrics.consent.accept')}
          </Button>
        </>
      }
    >
      <p className={s.lead}>{t('settings.metrics.consent.lead')}</p>

      <ul className={s.list}>
        {FIELDS.map((key) => (
          <li key={key} className={s.item}>
            <span className={s.itemName}>{t(`settings.metrics.fields.${key}.name`)}</span>
            <span className={s.itemValue}>{t(`settings.metrics.fields.${key}.value`)}</span>
          </li>
        ))}
      </ul>

      <ModalHint>{t('settings.metrics.never')}</ModalHint>
      <ModalHint>{t('settings.metrics.consent.retention')}</ModalHint>
      <ModalHint>{t('settings.metrics.consent.later')}</ModalHint>
    </Modal>
  );
};

import type { MetricsState } from '@shared-types';
import { Code2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebugFlag } from '~/stores/debug';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalSpacer } from '~/widgets/Modal/ModalKit';
import {
  ConfirmDialog,
  SettingAction,
  SettingGroup,
  SettingNote,
  SettingToggle,
} from '../ui/SettingsControls';
import s from './PrivacyPage.module.scss';

const FIELD_KEYS = ['install', 'version', 'os', 'locale', 'events', 'ip'] as const;

export const PrivacyPage = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<MetricsState | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  // Сборка без ключа приёмника показывает одну строку «недоступно» — и весь остальной экран в ней не посмотреть.
  const forceAvailable = useDebugFlag('metricsAvailable');

  useEffect(() => {
    let alive = true;
    void window.launcher.metrics.state().then((next) => {
      if (alive) setState(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const enabled = state?.enabled === true;

  const toggle = async () => {
    setState(await window.launcher.metrics.setEnabled(!enabled));
  };

  const showPreview = async () => {
    setPreview(await window.launcher.metrics.preview());
  };

  const resetId = async () => {
    setResetting(true);
    try {
      setState(await window.launcher.metrics.resetId());
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  if (!forceAvailable && state !== null && !state.available) {
    return (
      <SettingGroup label={t('settings.nav.sections.metrics')}>
        <SettingNote>{t('settings.metrics.unavailable')}</SettingNote>
      </SettingGroup>
    );
  }

  return (
    <>
      <SettingGroup label={t('settings.nav.sections.metrics')}>
        <SettingToggle
          title={t('settings.metrics.enabledLabel')}
          description={t('settings.metrics.enabledHint')}
          checked={enabled}
          onChange={() => void toggle()}
        />
        {state?.stopped && <SettingNote>{t('settings.metrics.stopped')}</SettingNote>}
      </SettingGroup>

      <SettingGroup label={t('settings.metrics.whatLabel')}>
        <ul className={s.fields}>
          {FIELD_KEYS.map((key) => (
            <li key={key} className={s.field}>
              <span className={s.fieldName}>{t(`settings.metrics.fields.${key}.name`)}</span>
              <span className={s.fieldValue}>{t(`settings.metrics.fields.${key}.value`)}</span>
            </li>
          ))}
        </ul>
        <SettingNote>{t('settings.metrics.never')}</SettingNote>
        <SettingNote>{t('settings.metrics.retention')}</SettingNote>
      </SettingGroup>

      <SettingGroup label={t('settings.nav.sections.maintenance')}>
        <SettingAction
          title={t('settings.metrics.previewLabel')}
          description={t('settings.metrics.previewHint')}
          icon={Code2}
          onClick={() => void showPreview()}
        />
        <SettingAction
          title={t('settings.metrics.resetLabel')}
          description={
            state?.installId
              ? t('settings.metrics.resetHint', { id: state.installId })
              : t('settings.metrics.resetHintNone')
          }
          icon={RefreshCw}
          danger
          busy={resetting}
          disabled={!state?.installId}
          onClick={() => setConfirmReset(true)}
        />
      </SettingGroup>

      {preview !== null && (
        <Modal
          title={t('settings.metrics.previewLabel')}
          size="lg"
          closable
          onClose={() => setPreview(null)}
          footer={
            <>
              <ModalSpacer />
              <Button variant="accent" size="sm" onClick={() => setPreview(null)}>
                {t('common.close')}
              </Button>
            </>
          }
        >
          {/* Прокрутка — тела диалога: у самой посылки своей полосы нет, иначе их было бы две одна в другой. */}
          <pre className={s.preview}>{preview}</pre>
        </Modal>
      )}

      {confirmReset && (
        <ConfirmDialog
          title={t('settings.metrics.resetLabel')}
          body={t('settings.metrics.resetConfirm')}
          cancelLabel={t('settings.metrics.cancel')}
          onClose={() => setConfirmReset(false)}
          busy={resetting}
          actions={[
            {
              label: t('settings.metrics.resetLabel'),
              variant: 'danger',
              onClick: () => void resetId(),
            },
          ]}
        />
      )}
    </>
  );
};

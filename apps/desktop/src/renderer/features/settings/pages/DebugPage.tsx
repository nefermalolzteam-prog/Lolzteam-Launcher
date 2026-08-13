import type { UpdateStatus } from '@shared-ipc';
import type { NotifyLevel } from '@shared-types';
import type { LucideIcon } from 'lucide-react';
import { Bell, CircleCheck, Download, Eye, RotateCw, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { setDebugFlag, useDebug, useDebugFlag } from '~/stores/debug';
import { notify } from '~/stores/notifications';
import { patchSettings, useSettings } from '~/stores/settings';
import { useUpdater } from '~/stores/updater';
import { SettingAction, SettingGroup, SettingNote, SettingToggle } from '../ui/SettingsControls';

/* ── Обновление ────────────────────────────────────────────────────────────── */

/** Заведомо несуществующий выпуск: увидев его в баннере, ни с чем не спутаешь. */
const FAKE_VERSION = '9.9.9';
const FAKE_TOTAL = 84 * 1024 * 1024;
const FAKE_ERROR = 'ERR_DEBUG: no such release';

/** Шаг поддельной загрузки: полоса доходит до конца примерно за пять секунд. */
const STEP_MS = 200;
const STEP_PERCENT = 4;

/** Состояния баннера, которые ставятся одним нажатием. */
const UPDATE_SHOTS: readonly { key: string; icon: LucideIcon; status: UpdateStatus }[] = [
  {
    key: 'available',
    icon: Download,
    status: { state: 'available', version: FAKE_VERSION, notes: null },
  },
  { key: 'downloaded', icon: RotateCw, status: { state: 'downloaded', version: FAKE_VERSION } },
  { key: 'error', icon: TriangleAlert, status: { state: 'error', message: FAKE_ERROR } },
  { key: 'clear', icon: X, status: { state: 'not-available' } },
];

/* ── Уведомления ───────────────────────────────────────────────────────────── */

const NOTIFY_SHOTS: readonly { level: NotifyLevel; icon: LucideIcon }[] = [
  { level: 'info', icon: Bell },
  { level: 'success', icon: CircleCheck },
  { level: 'warning', icon: TriangleAlert },
];

export const DebugPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const metricsAvailable = useDebugFlag('metricsAvailable');
  const toggleFlag = useDebug((st) => st.toggleFlag);

  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopDownload = useCallback(() => {
    if (tick.current !== null) {
      clearInterval(tick.current);
      tick.current = null;
    }
  }, []);

  // Уход со страницы — конец поддельной загрузки: таймер, переживший экран, продолжал бы двигать полосу у баннера.
  useEffect(() => stopDownload, [stopDownload]);

  /** Показать баннеру состояние. */
  const show = (status: UpdateStatus) => {
    useUpdater.setState({ dismissed: false });
    useUpdater.getState().setStatus(status);
  };

  const fakeDownload = () => {
    stopDownload();
    let percent = 0;
    show({ state: 'downloading', percent, transferred: 0, total: FAKE_TOTAL });
    tick.current = setInterval(() => {
      percent += STEP_PERCENT;
      if (percent >= 100) {
        stopDownload();
        // Загрузка кончается тем же, чем кончается настоящая, — предложением перезапуститься.
        show({ state: 'downloaded', version: FAKE_VERSION });
        return;
      }
      show({
        state: 'downloading',
        percent,
        transferred: Math.round((FAKE_TOTAL * percent) / 100),
        total: FAKE_TOTAL,
      });
    }, STEP_MS);
  };

  // Сырое значение, а не «спросили / согласился»: на этой странице читают состояние, а не рассказ о нём.
  const answer = settings === null ? '…' : String(settings.metricsEnabled);

  return (
    <>
      <SettingGroup>
        <SettingNote>{t('settings.debug.note')}</SettingNote>
      </SettingGroup>

      <SettingGroup label={t('settings.debug.sections.metrics')}>
        <SettingAction
          title={t('settings.debug.metrics.consentLabel')}
          description={t('settings.debug.metrics.consentHint')}
          icon={Eye}
          onClick={() => setDebugFlag('metricsConsent', true)}
        />
        <SettingAction
          title={t('settings.debug.metrics.resetLabel')}
          description={t('settings.debug.metrics.resetHint', { value: answer })}
          icon={RotateCw}
          danger
          disabled={settings === null || settings.metricsEnabled === null}
          onClick={() => void patchSettings({ metricsEnabled: null })}
        />
        <SettingToggle
          title={t('settings.debug.metrics.availableLabel')}
          description={t('settings.debug.metrics.availableHint')}
          checked={metricsAvailable}
          onChange={() => toggleFlag('metricsAvailable')}
        />
      </SettingGroup>

      <SettingGroup label={t('settings.debug.sections.update')}>
        <SettingAction
          title={t('settings.debug.update.downloadingLabel')}
          description={t('settings.debug.update.downloadingHint')}
          icon={Download}
          onClick={fakeDownload}
        />
        {UPDATE_SHOTS.map(({ key, icon, status }) => (
          <SettingAction
            key={key}
            title={t(`settings.debug.update.${key}Label`)}
            description={t(`settings.debug.update.${key}Hint`)}
            icon={icon}
            onClick={() => {
              // Любой ручной показ отменяет поддельную загрузку: иначе её таймер через полсекунды перебьёт то, что только что выбрали.
              stopDownload();
              show(status);
            }}
          />
        ))}
      </SettingGroup>

      <SettingGroup label={t('settings.debug.sections.notify')}>
        {NOTIFY_SHOTS.map(({ level, icon }) => (
          <SettingAction
            key={level}
            title={t(`settings.debug.notify.levels.${level}`)}
            description={t('settings.debug.notify.hint')}
            icon={icon}
            onClick={() =>
              // Через `notify`, а не прямо в список: настоящий путь проходит через настройки уведомлений.
              notify({
                category: 'update',
                level,
                title: { key: 'settings.debug.notify.title' },
                body: { key: 'settings.debug.notify.body', params: { level } },
              })
            }
          />
        ))}
      </SettingGroup>
    </>
  );
};

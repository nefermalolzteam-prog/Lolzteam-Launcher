import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { patchSettings, useSettings } from '~/stores/settings';
import {
  ConfirmDialog,
  SettingAction,
  SettingGroup,
  SettingInput,
  SettingToggle,
  type Tone,
} from '../ui/SettingsControls';

export const SteamPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** How the last clear ended — the row's second line is the only report. */
  const [result, setResult] = useState<'ok' | 'error' | null>(null);

  const autoLaunch = settings?.steamAutoLaunchGame ?? false;

  const clearSession = async () => {
    if (clearing) return;
    setConfirmOpen(false);
    setClearing(true);
    setResult(null);
    try {
      const res = await window.launcher.steam.clearSession();
      setResult(res.ok ? 'ok' : 'error');
    } catch {
      setResult('error');
    } finally {
      setClearing(false);
    }
  };

  const clearDescription = clearing
    ? t('settings.steam.clearing')
    : result === 'ok'
      ? t('settings.steam.cleared')
      : result === 'error'
        ? t('settings.steam.clearError')
        : t('settings.steam.clearHint');
  const clearTone: Tone = clearing
    ? 'muted'
    : result === 'ok'
      ? 'good'
      : result === 'error'
        ? 'warn'
        : 'muted';

  return (
    <>
      <SettingGroup label={t('settings.nav.sections.behavior')}>
        <SettingToggle
          title={t('settings.steam.invisibleLabel')}
          description={t('settings.steam.invisibleHint')}
          checked={settings?.steamInvisible ?? false}
          onChange={() =>
            void patchSettings({ steamInvisible: !(settings?.steamInvisible ?? false) })
          }
        />
        <SettingToggle
          title={t('settings.steam.autoLaunchLabel')}
          description={t('settings.steam.autoLaunchHint')}
          checked={autoLaunch}
          onChange={() => void patchSettings({ steamAutoLaunchGame: !autoLaunch })}
        />
        {/* The AppID only means anything once the launch is on, so it appears with it. */}
        {autoLaunch && (
          <SettingInput
            title={t('settings.steam.autoLaunchAppIdLabel')}
            description={t('settings.steam.autoLaunchAppIdHint')}
            value={settings?.steamAutoLaunchAppId ?? ''}
            onChange={(raw) =>
              void patchSettings({ steamAutoLaunchAppId: raw.replace(/\D/g, '').slice(0, 8) })
            }
            inputMode="numeric"
            placeholder={t('settings.steam.autoLaunchAppIdPlaceholder')}
          />
        )}
      </SettingGroup>

      <SettingGroup label={t('settings.nav.sections.session')}>
        <SettingAction
          title={t('settings.steam.clearLabel')}
          description={clearDescription}
          tone={clearTone}
          icon={Trash2}
          danger
          busy={clearing}
          onClick={() => setConfirmOpen(true)}
        />
      </SettingGroup>

      {confirmOpen && (
        <ConfirmDialog
          title={t('settings.steam.confirmTitle')}
          body={t('settings.steam.confirmBody')}
          cancelLabel={t('settings.steam.confirmCancel')}
          onClose={() => setConfirmOpen(false)}
          actions={[
            {
              label: t('settings.steam.confirmOk'),
              onClick: () => void clearSession(),
              variant: 'danger',
            },
          ]}
        />
      )}
    </>
  );
};

import { useTranslation } from 'react-i18next';
import { patchSettings, useSettings } from '~/stores/settings';
import {
  type ChoiceOption,
  SettingChoice,
  SettingGroup,
  SettingToggle,
} from '../ui/SettingsControls';

/** How often the grid refreshes itself while the window is out of sight. */
const BG_REFRESH_MINUTES: readonly number[] = [0, 15, 30, 60];

const CONCURRENCY_LIMITS: readonly number[] = [1, 2, 3, 4];

/** How the account grid keeps itself up to date. */
export const AccountsListPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);

  // Подписи собираются здесь, а не лежат константой.
  const bgRefreshOptions: readonly ChoiceOption<number>[] = BG_REFRESH_MINUTES.map((value) => ({
    value,
    label:
      value === 0
        ? t('settings.app.backgroundRefreshOff')
        : t('settings.app.backgroundRefreshEvery', { count: value }),
  }));

  const concurrencyOptions: readonly ChoiceOption<number>[] = CONCURRENCY_LIMITS.map((value) => ({
    value,
    label: t('settings.app.concurrencyValue', { count: value }),
  }));

  return (
    <SettingGroup label={t('settings.nav.sections.data')}>
      <SettingToggle
        title={t('settings.app.refreshOnLaunchLabel')}
        description={t('settings.app.refreshOnLaunchHint')}
        checked={settings?.refreshOnLaunch ?? true}
        onChange={() =>
          void patchSettings({ refreshOnLaunch: !(settings?.refreshOnLaunch ?? true) })
        }
      />
      <SettingChoice
        title={t('settings.app.backgroundRefreshLabel')}
        description={t('settings.app.backgroundRefreshHint')}
        options={bgRefreshOptions}
        columns={2}
        value={settings?.backgroundRefreshMinutes ?? 0}
        onChange={(backgroundRefreshMinutes) => void patchSettings({ backgroundRefreshMinutes })}
      />
      <SettingChoice
        title={t('settings.app.concurrencyLabel')}
        description={t('settings.app.concurrencyHint')}
        options={concurrencyOptions}
        columns={2}
        value={settings?.accountLoadConcurrency ?? 2}
        onChange={(accountLoadConcurrency) => void patchSettings({ accountLoadConcurrency })}
      />
    </SettingGroup>
  );
};

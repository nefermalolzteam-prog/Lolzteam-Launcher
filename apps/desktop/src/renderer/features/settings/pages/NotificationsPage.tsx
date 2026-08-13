import { NOTIFY_CATEGORIES, isNotifyCategoryEnabled } from '@shared-types';
import { useTranslation } from 'react-i18next';
import { patchSettings, useSettings } from '~/stores/settings';
import { SettingGroup, SettingToggle } from '../ui/SettingsControls';

/** Notifications, on their own page. */
export const NotificationsPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);

  const notifications = settings?.notifications ?? true;
  const notifySystem = settings?.notifySystem ?? true;

  return (
    <>
      <SettingGroup label={'Общее'}>
        <SettingToggle
          title={t('settings.notify.enabledLabel')}
          description={t('settings.notify.enabledHint')}
          checked={notifications}
          onChange={() => void patchSettings({ notifications: !notifications })}
        />
        {notifications && (
          <>
            <SettingToggle
              title={t('settings.notify.systemLabel')}
              description={t('settings.notify.systemHint')}
              checked={notifySystem}
              onChange={() => void patchSettings({ notifySystem: !notifySystem })}
            />
            <SettingToggle
              title={t('settings.notify.onlyHiddenLabel')}
              description={t('settings.notify.onlyHiddenHint')}
              checked={settings?.notifyOnlyWhenHidden ?? true}
              onChange={() =>
                void patchSettings({
                  notifyOnlyWhenHidden: !(settings?.notifyOnlyWhenHidden ?? true),
                })
              }
              disabled={!notifySystem}
            />
          </>
        )}
      </SettingGroup>

      {notifications && (
        <SettingGroup label={t('settings.nav.sections.categories')}>
          {NOTIFY_CATEGORIES.map((category) => {
            const on = isNotifyCategoryEnabled(settings, category);
            return (
              <SettingToggle
                key={category}
                title={t(`settings.notify.category.${category}`)}
                checked={on}
                // Written as an explicit `false` and never deleted: the stored record only has to list what is off.
                onChange={() =>
                  void patchSettings({
                    notifyCategories: { ...settings?.notifyCategories, [category]: !on },
                  })
                }
              />
            );
          })}
        </SettingGroup>
      )}
    </>
  );
};

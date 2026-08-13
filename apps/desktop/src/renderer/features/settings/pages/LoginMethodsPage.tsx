import type { ServiceId } from '@shared-types';
import { SUPPORTED_SERVICE_IDS, loginMethodsOf, serviceLabel } from '@shared-types';
import { useTranslation } from 'react-i18next';
import type { LoginMethod } from '~/stores/loginSession';
import { patchSettings, useSettings } from '~/stores/settings';
import { type ChoiceOption, SettingChoice, SettingGroup } from '../ui/SettingsControls';

/** Services that offer a choice of login method. */
const MULTI_METHOD: { id: ServiceId; methods: readonly LoginMethod[] }[] =
  SUPPORTED_SERVICE_IDS.map((id) => ({ id, methods: loginMethodsOf(id) })).filter(
    (entry) => entry.methods.length > 1,
  );

export const LoginMethodsPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const prefs = settings?.preferredLoginMethod ?? {};

  /** «Ask» is the absence of a preference rather than a value of its own. */
  const setMethod = (id: ServiceId, value: 'ask' | LoginMethod) => {
    const nextPref: Partial<Record<ServiceId, LoginMethod>> = {};
    for (const [k, v] of Object.entries(prefs)) {
      if (k !== id && v) nextPref[k as ServiceId] = v;
    }
    if (value !== 'ask') nextPref[id] = value;
    void patchSettings({ preferredLoginMethod: nextPref });
  };

  return (
    <SettingGroup>
      {MULTI_METHOD.map(({ id, methods }) => {
        const options: ChoiceOption<'ask' | LoginMethod>[] = ['ask' as const, ...methods].map(
          (opt) => ({ value: opt, label: t(`settings.loginMethods.${opt}`) }),
        );
        return (
          <SettingChoice
            key={id}
            // Per-service copy is optional: without it the row falls back to the brand name instead of showing a raw i18n key.
            title={t(`settings.loginMethods.${id}Label`, { defaultValue: serviceLabel(id) })}
            description={t(`settings.loginMethods.${id}Hint`, { defaultValue: '' })}
            options={options}
            columns={2}
            value={prefs[id] ?? 'ask'}
            onChange={(value) => setMethod(id, value)}
          />
        );
      })}
    </SettingGroup>
  );
};

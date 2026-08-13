import type { LocalePreference, MarketCurrency } from '@shared-types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencyModal } from '~/features/profile/CurrencyModal';
import { LanguageModal } from '~/features/profile/LanguageModal';
import { CURRENCY_FLAG, LOCALE_FLAG } from '~/lib/flags';
import { patchSettings, useSettings } from '~/stores/settings';
import { FlagValue, SettingAction, SettingGroup, SettingToggle } from '../ui/SettingsControls';

export const GeneralPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const [langOpen, setLangOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const authStatus = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => window.launcher.auth.getStatus(),
  });
  const curCode = authStatus.data?.session?.currency?.toLowerCase();
  const currencyFlag =
    curCode && curCode in CURRENCY_FLAG ? CURRENCY_FLAG[curCode as MarketCurrency] : undefined;

  const locale: LocalePreference = settings?.locale ?? 'ru';

  return (
    <>
      <SettingGroup label={t('settings.nav.sections.locale')}>
        <SettingAction
          title={t('settings.language.menuLabel')}
          description={
            <FlagValue code={LOCALE_FLAG[locale]}>{t(`settings.language.${locale}`)}</FlagValue>
          }
          onClick={() => setLangOpen(true)}
        />
        <SettingAction
          title={t('settings.currency.menuLabel')}
          description={
            <FlagValue code={currencyFlag}>
              {curCode ? curCode.toUpperCase() : t('settings.currency.menuHint')}
            </FlagValue>
          }
          onClick={() => setCurrencyOpen(true)}
        />
      </SettingGroup>

      <SettingGroup label={t('settings.nav.sections.window')}>
        <SettingToggle
          title={t('settings.app.minimizeToTrayLabel')}
          description={t('settings.app.minimizeToTrayHint')}
          checked={settings?.minimizeToTray ?? true}
          onChange={() =>
            void patchSettings({ minimizeToTray: !(settings?.minimizeToTray ?? true) })
          }
        />
      </SettingGroup>

      {langOpen && <LanguageModal onClose={() => setLangOpen(false)} />}
      {currencyOpen && <CurrencyModal onClose={() => setCurrencyOpen(false)} />}
    </>
  );
};

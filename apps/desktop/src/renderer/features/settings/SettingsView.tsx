import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import s from './SettingsView.module.scss';
import { PageActionsSlotProvider } from './pageActions';
import { SETTINGS_NAV, getSettingsPage } from './pages/registry';
import { useSettingsPage } from './settingsPage';

export const SettingsView = () => {
  const { t } = useTranslation();
  const page = useSettingsPage((p) => p.page);
  const setPage = useSettingsPage((p) => p.setPage);
  const { Component } = getSettingsPage(page);
  // Элемент, а не ref: страница рисует в него порталом и должна узнать о его появлении — ref-объект об этом не сообщает.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  return (
    <div className={s.container}>
      <nav className={s.rail} aria-label={t('settings.nav.aria')}>
        {SETTINGS_NAV.map((group) => (
          <div key={group.id} className={s.railGroup}>
            <span className={s.railGroupLabel}>{t(`settings.nav.groups.${group.id}`)}</span>
            {group.pages.map((id) => {
              const { icon: Icon } = getSettingsPage(id);
              const active = id === page;
              return (
                <button
                  key={id}
                  type="button"
                  className={`${s.railItem} ${active ? s.railItemActive : ''}`}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setPage(id)}
                >
                  <Icon size={17} className={s.railIcon} />
                  <span className={s.railLabel}>{t(`settings.nav.${id}.title`)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={s.content}>
        <header className={s.pageHead}>
          {/* `key` здесь не про списки: он делает смену раздела сменой узла. */}
          <div key={page} className={s.pageHeadText}>
            <h2 className={s.pageTitle}>{t(`settings.nav.${page}.title`)}</h2>
            <p className={s.pageHint}>{t(`settings.nav.${page}.hint`)}</p>
          </div>
          <div className={s.pageActions} ref={setActionsSlot} />
        </header>
        <PageActionsSlotProvider value={actionsSlot}>
          <div key={page} className={s.pageBody}>
            <Component />
          </div>
        </PageActionsSlotProvider>
      </div>
    </div>
  );
};

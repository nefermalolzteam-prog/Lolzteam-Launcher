import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { type ViewId, useView } from '~/stores/view';
import { AccountsIcon, MailIcon, SettingsIcon } from '~/widgets/icons/Icons';
import { ScrollTopButton } from './ScrollTopButton';
import s from './Sidebar.module.scss';
import { TaskDock } from './TaskDock';
import { UpdateDock, useUpdateAction } from './UpdateDock';

interface NavItem {
  id: string;
  labelKey: string;
  /** Anything that draws itself in a square of `size` px — our own glyphs and lucide's alike. */
  icon: ComponentType<{ size?: number }>;
  view?: ViewId;
}

const NAV: readonly NavItem[] = [
  { id: 'inventory', labelKey: 'sidebar.inventory', icon: AccountsIcon, view: 'inventory' },
  { id: 'mail', labelKey: 'sidebar.mail', icon: MailIcon, view: 'mail' },
  { id: 'settings', labelKey: 'sidebar.settings', icon: SettingsIcon, view: 'settings' },
] as const;

const PARENT: Partial<Record<ViewId, ViewId>> = { localAdd: 'inventory' };

export const Sidebar = () => {
  const { t } = useTranslation();
  const view = useView((st) => st.view);
  const setView = useView((st) => st.setView);
  const activeView = PARENT[view] ?? view;
  const update = useUpdateAction();

  return (
    <div className={s.dockContainer}>
      <TaskDock />
      <nav className={s.dock} aria-label="Primary">
        {NAV.map((item) => {
          const Icon = item.icon;
          const enabled = item.view !== undefined;
          const active = enabled && activeView === item.view;
          return (
            <button
              key={item.id}
              type="button"
              className={`${s.navItem} ${active ? s.navItemActive : ''}`}
              disabled={!enabled}
              onClick={enabled ? () => setView(item.view!) : undefined}
            >
              <Icon size={18} />
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>
      <div className={s.topDock}>
        <ScrollTopButton compact={update !== null} />
        {update && <UpdateDock action={update} />}
      </div>
    </div>
  );
};

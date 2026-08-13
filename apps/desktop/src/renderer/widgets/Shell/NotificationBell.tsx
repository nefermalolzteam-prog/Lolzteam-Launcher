import { Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAgo } from '~/lib/time';
import { useClockTick } from '~/lib/useClockTick';
import { useDismiss } from '~/lib/useDismiss';
import { type AppNotification, unreadCount, useNotifications } from '~/stores/notifications';
import { useSettings } from '~/stores/settings';
import { BellIcon, TrashIcon } from '~/widgets/icons/Icons';
import s from './NotificationBell.module.scss';

const Row = ({ item, onRemove }: { item: AppNotification; onRemove: () => void }) => {
  const { t, i18n } = useTranslation();
  // Re-renders the whole panel on the shared minute tick.
  useClockTick();
  const dotClass =
    item.level === 'success' ? s.dotSuccess : item.level === 'warning' ? s.dotWarning : '';
  return (
    <li className={`${s.item} ${item.read ? '' : s.itemUnread}`}>
      <span className={`${s.dot} ${dotClass}`} aria-hidden />
      <span className={s.itemText}>
        <span className={s.itemTitle}>{t(item.title.key, item.title.params ?? {})}</span>
        {item.body && (
          <span className={s.itemBody}>{t(item.body.key, item.body.params ?? {})}</span>
        )}
        <span className={s.itemTime}>{formatAgo(item.at, i18n.language)}</span>
      </span>
      <button
        type="button"
        className={s.itemRemove}
        onClick={onRemove}
        aria-label={t('notify.remove')}
        title={t('notify.remove')}
      >
        <X size={14} />
      </button>
    </li>
  );
};

export const NotificationBell = () => {
  const { t } = useTranslation();
  const enabled = useSettings((st) => st.settings?.notifications ?? true);
  const items = useNotifications((st) => st.items);
  const markAllRead = useNotifications((st) => st.markAllRead);
  const remove = useNotifications((st) => st.remove);
  const clear = useNotifications((st) => st.clear);
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const unread = useMemo(() => unreadCount(items), [items]);

  // Off in settings means the feature is not here at all — see `LauncherSettings.notifications`.
  if (!enabled) return null;

  const toggle = () => {
    // Opening is the reading.
    if (!open) markAllRead();
    setOpen((was) => !was);
  };

  return (
    <div className={s.bell} ref={ref}>
      <button
        type="button"
        className={s.trigger}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? t('notify.bellUnread', { count: unread }) : t('notify.bell')}
      >
        <BellIcon size={20} />
        {unread > 0 && (
          <span className={s.badge} aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={s.panel} role="dialog" aria-label={t('notify.bell')}>
          <div className={s.head}>
            <span className={s.headTitle}>{t('notify.bell')}</span>
            {items.length > 0 && (
              <span className={s.headActions}>
                <button
                  type="button"
                  className={s.headButton}
                  onClick={markAllRead}
                  title={t('notify.markAllRead')}
                  aria-label={t('notify.markAllRead')}
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  className={s.headButton}
                  onClick={clear}
                  title={t('notify.clear')}
                  aria-label={t('notify.clear')}
                >
                  <TrashIcon size={15} />
                </button>
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <p className={s.empty}>{t('notify.empty')}</p>
          ) : (
            <ul className={s.list}>
              {items.map((item) => (
                <Row key={item.id} item={item} onRemove={() => remove(item.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

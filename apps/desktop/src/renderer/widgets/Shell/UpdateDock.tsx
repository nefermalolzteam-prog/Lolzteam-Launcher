import type { UpdateStatus } from '@shared-ipc';
import type { LucideIcon } from 'lucide-react';
import { Download, RefreshCw, RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdater } from '~/stores/updater';
import s from './UpdateDock.module.scss';

export type UpdateActionKey = 'available' | 'downloaded' | 'error';

/** Обновление как одно нажатие: что произошло и что с этим делать. */
export interface UpdateAction {
  readonly key: UpdateActionKey;
  /** Есть у «доступна» и «скачана», нет у ошибки. */
  readonly version: string | null;
  /** Текст ошибки — как его прислал главный процесс. */
  readonly message: string | null;
  readonly run: () => void;
}

const ICON: Record<UpdateActionKey, LucideIcon> = {
  available: Download,
  downloaded: RotateCw,
  error: RefreshCw,
};

const actionOf = (status: UpdateStatus): UpdateAction | null => {
  switch (status.state) {
    case 'available':
      return {
        key: 'available',
        version: status.version,
        message: null,
        run: () => void window.launcher.updater.download(),
      };
    case 'downloaded':
      return {
        key: 'downloaded',
        version: status.version,
        message: null,
        run: () => void window.launcher.updater.install(),
      };
    case 'error':
      return {
        key: 'error',
        version: null,
        message: status.message,
        run: () => void window.launcher.updater.check(),
      };
    // «Проверяем», «нечего ставить» и сама загрузка — состояния, в которых нажимать нечего.
    default:
      return null;
  }
};

/** `null` — показывать нечего: либо нет новостей, либо их уже закрыли крестиком. */
export const useUpdateAction = (): UpdateAction | null => {
  const status = useUpdater((st) => st.status);
  const dismissed = useUpdater((st) => st.dismissed);
  return status === null || dismissed ? null : actionOf(status);
};

export const UpdateDock = ({ action }: { action: UpdateAction }) => {
  const { t } = useTranslation();
  const dismiss = useUpdater((st) => st.dismiss);
  const Icon = ICON[action.key];

  const title =
    action.key === 'error'
      ? t('update.error')
      : t(`update.dock.${action.key}`, { version: action.version ?? '' });

  const label =
    action.key === 'available'
      ? t('update.download')
      : action.key === 'downloaded'
        ? t('update.restart')
        : t('common.retry');

  return (
    <div className={`${s.dock} ${action.key === 'error' ? s.dockError : ''}`} role="status">
      <button
        type="button"
        className={s.trigger}
        onClick={action.run}
        // Подпись целиком, а не одно из двух: у ошибки вторая строка занята её причиной.
        aria-label={`${title} — ${label}`}
        title={label}
      >
        <span className={s.well}>
          <Icon size={22} />
        </span>
        <span className={s.text}>
          <span className={s.title}>{title}</span>
          {/* У ошибки вторая строка — это её причина; в остальных случаях — что произойдёт по нажатию. */}
          <span className={`${s.description} ${action.message ? s.descriptionTruncate : ''}`}>
            {action.message ?? label}
          </span>
        </span>
      </button>
      {/* Крестик — не «отказаться от обновления», а «не сейчас»: то же самое лежит в настройках, на странице «О программе». */}
      <button
        type="button"
        className={s.close}
        onClick={dismiss}
        aria-label={t('common.close')}
        title={t('common.close')}
      >
        <X size={14} />
      </button>
    </div>
  );
};

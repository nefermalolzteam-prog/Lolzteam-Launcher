import { useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Github, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearAccountsCacheAndRestream } from '~/stores/accountsStream';
import { useUpdater } from '~/stores/updater';
import { SettingAction, SettingGroup, type Tone } from '../ui/SettingsControls';
import { LolzteamIcon, serviceIcon } from '../ui/SettingsIcons';
import s from './AboutPage.module.scss';

/** Куда уходит человек со дна «О программе»: исходники, тема на форуме, канал. */
const LINKS = [
  { url: 'https://github.com/iamextasy/Lolzteam-Launcher', label: 'GitHub', Icon: Github },
  { url: 'https://lolz.team/threads/10024162/', label: 'Lolzteam', Icon: LolzteamIcon },
  { url: 'https://t.me/lolzteam_launcher', label: 'Telegram', Icon: serviceIcon('telegram') },
] as const;

export const AboutPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const updateStatus = useUpdater((u) => u.status);
  const setUpdateStatus = useUpdater((u) => u.setStatus);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [exportingLog, setExportingLog] = useState(false);
  const [logExported, setLogExported] = useState(false);

  useEffect(() => window.launcher.updater.onStatus(setUpdateStatus), [setUpdateStatus]);

  useEffect(() => {
    let alive = true;
    window.launcher.app.getVersion().then((v) => {
      if (alive) setAppVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const clearCache = async () => {
    if (clearingCache) return;
    setClearingCache(true);
    setCacheCleared(false);
    try {
      // Re-streams as well: an invalidate alone would refetch an empty cache and leave «Мои аккаунты» claiming the user owns.
      await clearAccountsCacheAndRestream(qc);
      setCacheCleared(true);
    } finally {
      setClearingCache(false);
    }
  };

  const exportLog = async () => {
    if (exportingLog) return;
    setExportingLog(true);
    setLogExported(false);
    try {
      const result = await window.launcher.app.exportLog();
      if (result.ok) setLogExported(true);
    } finally {
      setExportingLog(false);
    }
  };

  const checkingUpdate = updateStatus?.state === 'checking';
  const updateTone: Tone =
    updateStatus?.state === 'available' || updateStatus?.state === 'downloaded'
      ? 'good'
      : updateStatus?.state === 'error'
        ? 'warn'
        : 'muted';
  const updateDescription = (() => {
    switch (updateStatus?.state) {
      case 'checking':
        return t('settings.update.checking');
      case 'available':
        return t('settings.update.available', { version: updateStatus.version });
      case 'not-available':
        return t('settings.update.notAvailable', { version: appVersion ?? '' });
      case 'downloading':
        return t('settings.update.downloading');
      case 'downloaded':
        return t('settings.update.downloaded', { version: updateStatus.version });
      case 'error':
        return t('settings.update.error');
      default:
        return t('settings.update.menuHint', { version: appVersion ?? '' });
    }
  })();

  return (
    <>
      <SettingGroup label={t('settings.nav.sections.version')}>
        <SettingAction
          title={t('settings.update.menuLabel')}
          description={updateDescription}
          tone={updateTone}
          icon={Download}
          busy={checkingUpdate}
          onClick={() => void window.launcher.updater.check()}
        />
      </SettingGroup>

      <SettingGroup label={t('settings.nav.sections.maintenance')}>
        <SettingAction
          title={t('settings.cache.menuLabel')}
          description={
            clearingCache
              ? t('settings.cache.clearing')
              : cacheCleared
                ? t('settings.cache.cleared')
                : t('settings.cache.menuHint')
          }
          tone={cacheCleared && !clearingCache ? 'good' : 'muted'}
          icon={Trash2}
          busy={clearingCache}
          onClick={() => void clearCache()}
        />
        <SettingAction
          title={t('settings.logs.menuLabel')}
          description={
            exportingLog
              ? t('settings.logs.exporting')
              : logExported
                ? t('settings.logs.exported')
                : t('settings.logs.menuHint')
          }
          tone={logExported && !exportingLog ? 'good' : 'muted'}
          icon={FileText}
          busy={exportingLog}
          onClick={() => void exportLog()}
        />
      </SettingGroup>

      <div className={s.social}>
        {LINKS.map(({ url, label, Icon }) => (
          <button
            key={url}
            type="button"
            className={s.socialItem}
            onClick={() => void window.launcher.app.openExternal(url)}
          >
            <Icon className={s.socialIcon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </>
  );
};

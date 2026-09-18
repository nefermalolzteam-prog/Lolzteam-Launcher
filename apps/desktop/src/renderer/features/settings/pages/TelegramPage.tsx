import { ExternalLink, FolderOpen, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IS_POSIX_DESKTOP, PLATFORM } from '~/lib/platform';
import { patchSettings, useSettings } from '~/stores/settings';
import {
  type ChoiceOption,
  SettingAction,
  SettingChoice,
  SettingGroup,
  SettingIconButton,
  SettingRow,
} from '../ui/SettingsControls';

/** Лимит аккаунтов в клиенте; `0` — «сколько угодно». */
const TG_ACCOUNT_LIMITS: readonly number[] = [3, 4, 0];

/** Accounts a «База» run touches at once. */
const TG_TASK_LIMITS: readonly number[] = [1, 2, 3, 4, 5];

const RELEASES_URL = 'https://github.com/telegramdesktop/tdesktop/releases/latest';

export const TelegramPage = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const [picking, setPicking] = useState(false);

  const tgPath = settings?.telegramExePath ?? null;

  // On Linux and macOS an empty setting is the normal case: the packaged
  // client is found on its own. Show what was found so the row does not read
  // as "nothing set".
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    if (!IS_POSIX_DESKTOP || tgPath) return;
    let live = true;
    void window.launcher.telegram
      .detectBinary()
      .then((result) => {
        if (live) setDetected(result?.path ?? null);
      })
      .catch(() => {
        if (live) setDetected(null);
      });
    return () => {
      live = false;
    };
  }, [tgPath]);

  const clientDescription =
    tgPath ??
    (IS_POSIX_DESKTOP && detected
      ? t('settings.telegram.detected', { path: detected })
      : t('settings.telegram.placeholderNoFile', { context: PLATFORM }));

  // Подписи вариантов живут в переводе, а не в константе рядом с числами.
  const accountOptions: readonly ChoiceOption<number>[] = TG_ACCOUNT_LIMITS.map((value) => ({
    value,
    label:
      value === 0
        ? t('settings.telegram.accountsUnlimited')
        : t('settings.telegram.accountsValue', { count: value }),
  }));

  const taskOptions: readonly ChoiceOption<number>[] = TG_TASK_LIMITS.map((value) => ({
    value,
    label: t('settings.telegram.taskConcurrencyValue', { count: value }),
  }));

  const pickExe = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const path = await window.launcher.settings.pickFile({
        title: t('settings.telegram.pickDialogTitle', { context: PLATFORM }),
        // Linux and macOS executables carry no extension, so filtering on one
        // would hide every candidate the user could possibly pick.
        filters: [
          {
            name: t('settings.telegram.pickFilterName', { context: PLATFORM }),
            extensions: PLATFORM === 'win32' ? ['exe'] : ['*'],
          },
        ],
      });
      if (path) await patchSettings({ telegramExePath: path });
    } finally {
      setPicking(false);
    }
  };

  return (
    <>
      <SettingGroup label={t('settings.nav.sections.client')}>
        {/* Two things to do with one value — choose the file, or forget it — so the row itself is not a button. */}
        <SettingRow
          title={t('settings.telegram.sessionFolder', { context: PLATFORM })}
          description={clientDescription}
          truncate
          alert={t('settings.telegram.alert', { context: PLATFORM })}
        >
          <SettingIconButton
            icon={FolderOpen}
            label={t('settings.telegram.pickButton')}
            onClick={() => void pickExe()}
            busy={picking}
          />
          {tgPath && (
            <SettingIconButton
              icon={RotateCcw}
              label={t('settings.telegram.clear')}
              onClick={() => void patchSettings({ telegramExePath: null })}
            />
          )}
        </SettingRow>
        <SettingAction
          title={t('settings.telegram.releaseLabel')}
          description={t('settings.telegram.releaseHint', { context: PLATFORM })}
          icon={ExternalLink}
          onClick={() => void window.launcher.app.openExternal(RELEASES_URL)}
        />
      </SettingGroup>

      <SettingGroup label={t('settings.nav.sections.limits')}>
        <SettingChoice
          title={t('settings.telegram.accountsLabel')}
          description={t('settings.telegram.accountsHint')}
          options={accountOptions}
          columns={2}
          value={settings?.telegramMaxAccounts ?? 3}
          onChange={(telegramMaxAccounts) => void patchSettings({ telegramMaxAccounts })}
        />
        <SettingChoice
          title={t('settings.telegram.taskConcurrencyLabel')}
          description={t('settings.telegram.taskConcurrencyHint')}
          options={taskOptions}
          columns={2}
          value={settings?.telegramTaskConcurrency ?? 3}
          onChange={(telegramTaskConcurrency) => void patchSettings({ telegramTaskConcurrency })}
        />
      </SettingGroup>
    </>
  );
};

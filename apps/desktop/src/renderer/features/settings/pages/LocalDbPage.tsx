import type { LocalDbEntry, LocalDbMoveMode } from '@shared-types';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { Check, FolderOpen, FolderSymlink, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reloadAfterDbChange, useLocalDb } from '~/stores/localDb';
import { useSettings } from '~/stores/settings';
import {
  ConfirmDialog,
  SettingAction,
  SettingGroup,
  SettingIconButton,
  SettingRow,
} from '../ui/SettingsControls';

/** The folder's own name — the path is on the line below it. */
const baseName = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

interface BaseRowProps {
  base: LocalDbEntry;
  busy: boolean;
  alert: string | null;
  onSwitch: () => void;
  onReveal: () => void;
  onForget: () => void;
}

const BaseRow = ({ base, busy, alert, onSwitch, onReveal, onForget }: BaseRowProps) => {
  const { t } = useTranslation();

  const title = base.dir === null ? t('settings.localDb.defaultPath') : baseName(base.path);
  const counts = base.counts;
  const description = !base.available
    ? t('settings.localDb.unavailable')
    : counts
      ? t('settings.localDb.counts', { steam: counts.steam, telegram: counts.telegram })
      : t('settings.localDb.unknownCounts');

  return (
    <SettingRow
      title={title}
      description={description}
      tone={!base.available ? 'warn' : base.current ? 'good' : 'muted'}
      alert={alert ?? (base.current ? base.path : null)}
    >
      {/* The current base keeps a disabled tick rather than losing the control. */}
      <SettingIconButton
        icon={Check}
        label={
          base.current ? t('settings.localDb.currentBase') : t('settings.localDb.switchButton')
        }
        onClick={onSwitch}
        disabled={base.current || !base.available || busy}
      />
      <SettingIconButton
        icon={FolderOpen}
        label={t('settings.localDb.openFolder')}
        onClick={onReveal}
        disabled={!base.available}
      />
      {base.dir !== null && !base.current && (
        <SettingIconButton
          icon={X}
          label={t('settings.localDb.forgetButton')}
          onClick={onForget}
          disabled={busy}
          danger
        />
      )}
    </SettingRow>
  );
};

export const LocalDbPage = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useSettings((st) => st.settings);
  const bases = useLocalDb((st) => st.bases);
  const load = useLocalDb((st) => st.load);
  const switching = useLocalDb((st) => st.switching);

  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  /** Which base refused to open, and why — shown on its own row. */
  const [switchError, setSwitchError] = useState<{ dir: string | null; message: string } | null>(
    null,
  );
  /** Folder the user picked for a move that turned out to already hold a database. */
  const [conflict, setConflict] = useState<{ dir: string | null } | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTo = async (dir: string | null, client: QueryClient) => {
    setSwitchError(null);
    const reason = await useLocalDb.getState().switchTo(dir, client);
    if (reason !== 'ok') setSwitchError({ dir, message: t(`settings.localDb.errors.${reason}`) });
  };

  const addBase = async () => {
    const dir = await window.launcher.localDb.pickDir();
    // Picking a folder is the whole gesture: an empty one becomes a new base.
    if (dir) await switchTo(dir, qc);
  };

  /** Moving the local database. */
  const applyDir = async (dir: string | null, mode: LocalDbMoveMode) => {
    if (busy) return;
    setBusy(true);
    setMoveError(null);
    const res = await window.launcher.localDb.setDir(dir, mode);
    setBusy(false);
    if (res.ok) {
      setConflict(null);
      await reloadAfterDbChange(qc);
      return;
    }
    if (res.reason === 'target_exists') {
      setConflict({ dir });
      return;
    }
    // Picking the folder it is already in is a no-op, not a failure.
    if (res.reason !== 'same_dir') setMoveError(t(`settings.localDb.errors.${res.reason}`));
  };

  const pickMoveTarget = async () => {
    if (busy) return;
    const dir = await window.launcher.localDb.pickDir();
    if (dir) await applyDir(dir, 'move');
  };

  return (
    <>
      <SettingGroup label={t('settings.localDb.basesLabel')}>
        {bases.map((base) => (
          <BaseRow
            key={base.path}
            base={base}
            busy={switching || busy}
            alert={
              switchError && switchError.dir === base.dir && !base.current
                ? switchError.message
                : null
            }
            onSwitch={() => void switchTo(base.dir, qc)}
            onReveal={() => void window.launcher.localDb.reveal(base.dir)}
            onForget={() => void (base.dir && useLocalDb.getState().forget(base.dir))}
          />
        ))}
        <SettingAction
          title={t('settings.localDb.addLabel')}
          description={t('settings.localDb.addHint')}
          icon={Plus}
          onClick={() => void addBase()}
          busy={switching}
        />
      </SettingGroup>

      <SettingGroup label={t('settings.localDb.moveLabel')}>
        {/* A failed move replaces the standing caveat rather than joining it: both lines are amber. */}
        <SettingRow
          title={t('settings.localDb.folderLabel')}
          description={settings?.localDbDir ?? t('settings.localDb.defaultPath')}
          truncate
          alert={moveError ?? t('settings.localDb.alert')}
        >
          <SettingIconButton
            icon={FolderSymlink}
            label={t('settings.localDb.moveButton')}
            onClick={() => void pickMoveTarget()}
            busy={busy && !conflict}
          />
          {settings?.localDbDir && (
            <SettingIconButton
              icon={RotateCcw}
              label={t('settings.localDb.reset')}
              onClick={() => void applyDir(null, 'move')}
              disabled={busy}
            />
          )}
        </SettingRow>
      </SettingGroup>

      {conflict && (
        <ConfirmDialog
          title={t('settings.localDb.conflictTitle')}
          body={t('settings.localDb.conflictBody', {
            dir: conflict.dir ?? t('settings.localDb.defaultPath'),
          })}
          cancelLabel={t('settings.localDb.conflictCancel')}
          onClose={() => setConflict(null)}
          busy={busy}
          actions={[
            {
              label: t('settings.localDb.conflictAdopt'),
              onClick: () => void applyDir(conflict.dir, 'adopt'),
            },
            {
              label: t('settings.localDb.conflictReplace'),
              onClick: () => void applyDir(conflict.dir, 'replace'),
              variant: 'danger',
            },
          ]}
        />
      )}
    </>
  );
};

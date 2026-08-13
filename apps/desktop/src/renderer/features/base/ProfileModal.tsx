import type {
  TelegramAvatarPack,
  TelegramGender,
  TelegramNameLocale,
  TelegramProfileRequest,
} from '@shared-types';
import { FolderOpen, UserRoundPen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '~/stores/settings';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalCheck,
  ModalChecks,
  ModalChip,
  ModalChips,
  ModalError,
  ModalGroup,
  ModalHint,
  ModalIconButton,
  ModalOption,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';
import { ProxySpreadRow, useProxySpread } from './ProxySpreadRow';

interface ProfileModalProps {
  count: number;
  /** Set when a run was refused — right now only «в папке ничего нет». */
  error: string | null;
  onCancel: () => void;
  onStart: (req: Omit<TelegramProfileRequest, 'accountIds'>) => void;
}

const GENDERS: readonly TelegramGender[] = ['male', 'female', 'mixed'];
const LOCALES: readonly TelegramNameLocale[] = ['ru', 'en', 'mixed'];

export const ProfileModal = ({ count, error, onCancel, onStart }: ProfileModalProps) => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);

  const [gender, setGender] = useState<TelegramGender>('mixed');
  const [locale, setLocale] = useState<TelegramNameLocale>('mixed');
  const [withName, setWithName] = useState(true);
  const [withBio, setWithBio] = useState(true);
  const [replaceAvatar, setReplaceAvatar] = useState(true);
  const [busy, setBusy] = useState(false);
  const proxy = useProxySpread('telegram');

  // The folder is remembered in the settings, so the second run is one click.
  const [dir, setDir] = useState<string | null>(settings?.telegramAvatarDir ?? null);
  const [pack, setPack] = useState<TelegramAvatarPack | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!dir) {
      setPack(null);
      return;
    }
    let alive = true;
    setScanning(true);
    void window.launcher.telegram.avatarPack(dir).then((next) => {
      if (!alive) return;
      setPack(next);
      setScanning(false);
    });
    return () => {
      alive = false;
    };
  }, [dir]);

  const pickDir = async (): Promise<void> => {
    const { path } = await window.launcher.telegram.pickPath('dir', t('base.profile.pickTitle'));
    if (!path) return;
    setDir(path);
    void window.launcher.settings.set({ telegramAvatarDir: path });
  };

  const clearDir = (): void => {
    setDir(null);
    void window.launcher.settings.set({ telegramAvatarDir: null });
  };

  const usable = dir !== null && pack !== null && pack.error === null;
  // A run that would write nothing is not a run.
  const nothing = !withName && !withBio && !usable;

  const start = (): void => {
    if (busy || nothing) return;
    setBusy(true);
    onStart({
      gender,
      locale,
      withName,
      withBio,
      avatarDir: usable ? dir : null,
      replaceAvatar,
      proxyIds: proxy.proxyIds,
    });
  };

  // Re-enable the button when the run was refused.
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  return (
    <Modal
      title={t('base.profile.title')}
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('base.check.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            icon={UserRoundPen}
            busy={busy}
            disabled={nothing}
            title={nothing ? t('base.profile.nothingToDo') : undefined}
            onClick={start}
          >
            {t('base.profile.start')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>{t('base.profile.lead', { count })}</ModalHint>

      <ModalGroup>{t('base.profile.gender')}</ModalGroup>
      <ModalChips>
        {GENDERS.map((it) => (
          <ModalChip
            key={it}
            label={t(`base.profile.genders.${it}`)}
            selected={gender === it}
            onClick={() => setGender(it)}
          />
        ))}
      </ModalChips>

      <ModalGroup>{t('base.profile.locale')}</ModalGroup>
      <ModalChips>
        {LOCALES.map((it) => (
          <ModalChip
            key={it}
            label={t(`base.profile.locales.${it}`)}
            selected={locale === it}
            onClick={() => setLocale(it)}
          />
        ))}
      </ModalChips>

      <ModalChecks>
        <ModalCheck checked={withName} onChange={setWithName} hint={t('base.profile.withNameHint')}>
          {t('base.profile.withName')}
        </ModalCheck>
        <ModalCheck checked={withBio} onChange={setWithBio} hint={t('base.profile.withBioHint')}>
          {t('base.profile.withBio')}
        </ModalCheck>
      </ModalChecks>

      <ModalGroup>{t('base.profile.avatars')}</ModalGroup>
      {/* Строка выбора, а не кнопка с путём рядом: путь и есть значение. */}
      <ModalOption
        icon={FolderOpen}
        title={dir ?? t('base.profile.pickDir')}
        action="none"
        onClick={() => void pickDir()}
        trailing={
          dir ? (
            <ModalIconButton icon={X} label={t('base.profile.clearDir')} onClick={clearDir} />
          ) : undefined
        }
      />
      {/* Под строкой, а не подписью внутри неё: ошибка распознавания папки — это предложение целиком. */}
      <ModalHint>
        {scanning
          ? t('base.profile.scanning')
          : !dir
            ? t('base.profile.noDirHint')
            : pack?.error
              ? t(`base.profile.packError.${pack.error}`)
              : t('base.profile.packFound', {
                  photos: pack?.photos ?? 0,
                  videos: pack?.videos ?? 0,
                })}
        {/* Only worth saying when the pack is split: it is why a woman's name does not end up over a man's face. */}
        {usable && (pack?.male ?? 0) + (pack?.female ?? 0) > 0 && (
          <>
            <br />
            {t('base.profile.packGendered', {
              male: pack?.male ?? 0,
              female: pack?.female ?? 0,
            })}
          </>
        )}
      </ModalHint>

      {usable && (
        <ModalChecks>
          <ModalCheck
            checked={replaceAvatar}
            onChange={setReplaceAvatar}
            hint={t('base.profile.replaceAvatarHint')}
          >
            {t('base.profile.replaceAvatar')}
          </ModalCheck>
        </ModalChecks>
      )}

      <ProxySpreadRow
        state={proxy}
        hint={t('base.check.spreadHint')}
        noProxy={t('base.check.noProxy')}
      />
    </Modal>
  );
};

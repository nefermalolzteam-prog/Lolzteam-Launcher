import type { AccountSummary, GuardAuthSessionInfo } from '@shared-types';
import {
  Check,
  ImageUp,
  Link2,
  Loader2,
  MapPin,
  Monitor,
  ScanLine,
  ShieldX,
  Wifi,
} from 'lucide-react';
import { type ComponentProps, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalChip,
  ModalChips,
  ModalError,
  ModalField,
  ModalHint,
  ModalInput,
  ModalOption,
  ModalSpacer,
  ModalStatus,
  ModalWarn,
} from '~/widgets/Modal/ModalKit';
import s from './GuardModal.module.scss';
import { ScreenScanner } from './ScreenScanner';
import { decodeQrFromFile } from './decodeQr';

interface ApproveLoginModalProps {
  item: AccountSummary;
  onClose: () => void;
}

type Stage =
  | { kind: 'input' }
  | { kind: 'preview'; info: GuardAuthSessionInfo }
  | { kind: 'done'; approved: boolean };

/** Where the QR comes from. */
type Source = 'link' | 'image' | 'screen';

type ChipIcon = ComponentProps<typeof ModalChip>['icon'];

const SOURCES: ReadonlyArray<{ id: Source; icon: ChipIcon; labelKey: string }> = [
  { id: 'link', icon: Link2, labelKey: 'guard.approve.sourceLink' },
  { id: 'image', icon: ImageUp, labelKey: 'guard.approve.sourceImage' },
  { id: 'screen', icon: ScanLine, labelKey: 'guard.approve.sourceScreen' },
];

/** Approve — or refuse — a login someone is holding a Steam QR for. */
export const ApproveLoginModal = ({ item, onClose }: ApproveLoginModalProps) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [source, setSource] = useState<Source>('link');
  const [stage, setStage] = useState<Stage>({ kind: 'input' });
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const fail = (reason: string, message?: string) => {
    const text = t(`guard.error.${reason}`);
    setError(message ? `${text}: ${message}` : text);
  };

  const lookUp = async (value: string) => {
    setBusy(true);
    setError(null);
    const result = await window.launcher.steamGuard.sessionInfo(item.itemId, value);
    setBusy(false);
    if (!result.ok) {
      fail(result.reason, result.message);
      return;
    }
    setStage({ kind: 'preview', info: result.info });
  };

  /** A decoded QR is treated exactly like a pasted link, preview included. */
  const useDecoded = (payload: string) => {
    setUrl(payload);
    void lookUp(payload);
  };

  const readImage = async (files: FileList | readonly File[] | null) => {
    const file = Array.from(files ?? []).find((f) => f.type.startsWith('image/'));
    if (!file) {
      setError(t('guard.approve.notAnImage'));
      return;
    }
    setBusy(true);
    setError(null);
    const payload = await decodeQrFromFile(file);
    setBusy(false);
    if (!payload) {
      setError(t('guard.approve.qrNotFound'));
      return;
    }
    useDecoded(payload);
  };

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    const result = await window.launcher.steamGuard.approve(item.itemId, url, approve);
    setBusy(false);
    if (!result.ok) {
      fail(result.reason, result.message);
      return;
    }
    setStage({ kind: 'done', approved: result.approved });
  };

  const location = (info: GuardAuthSessionInfo): string =>
    [info.city, info.state, info.country].filter(Boolean).join(', ') || t('guard.approve.unknown');

  /** Один факт о сессии строкой: значок, о чём речь, само значение справа. */
  const detail = (icon: ChipIcon, label: string, value: string) => (
    <ModalOption
      icon={icon}
      title={label}
      action="none"
      trailing={<span className={s.value}>{value}</span>}
    />
  );

  const footer =
    stage.kind === 'input' ? (
      <>
        <ModalSpacer />
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {t('guard.link.cancel')}
        </Button>
        {/* Кнопка только у ссылки: картинку и экран продвигает сам их шаг. */}
        {source === 'link' && (
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={url.trim().length === 0}
            onClick={() => void lookUp(url)}
          >
            {t('guard.approve.continue')}
          </Button>
        )}
      </>
    ) : stage.kind === 'preview' ? (
      <>
        <Button
          variant="danger"
          size="sm"
          icon={ShieldX}
          disabled={busy}
          onClick={() => void decide(false)}
        >
          {t('guard.approve.deny')}
        </Button>
        <ModalSpacer />
        <Button
          variant="accent"
          size="sm"
          icon={Check}
          busy={busy}
          onClick={() => void decide(true)}
        >
          {t('guard.approve.allow')}
        </Button>
      </>
    ) : (
      <>
        <ModalSpacer />
        <Button variant="accent" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </>
    );

  return (
    <Modal
      title={t('guard.approve.title')}
      subtitle={item.title}
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={footer}
    >
      {stage.kind === 'input' && (
        <>
          <ModalHint>{t('guard.approve.explain', { account: item.title })}</ModalHint>

          <ModalChips>
            {SOURCES.map(({ id, icon, labelKey }) => (
              <ModalChip
                key={id}
                icon={icon}
                label={t(labelKey)}
                selected={id === source}
                disabled={busy}
                onClick={() => {
                  setSource(id);
                  setError(null);
                }}
              />
            ))}
          </ModalChips>

          {source === 'link' && (
            <ModalField label={t('guard.approve.urlLabel')} note={t('guard.approve.urlHint')}>
              <ModalInput
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="https://s.team/q/1/..."
                // Ссылку сюда вставляют — это первое и единственное, что здесь делают руками.
                autoFocus
                disabled={busy}
              />
            </ModalField>
          )}

          {/* Своя зона, а не поле кита: сюда не пишут, а бросают файл, и всё её устройство — большая мишень с пунктиром. */}
          {source === 'image' && (
            <div
              className={dragging ? s.dropZoneActive : s.dropZone}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void readImage(e.dataTransfer.files);
              }}
              onPaste={(e) => void readImage(e.clipboardData.files)}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className={s.fileInput}
                onChange={(e) => {
                  void readImage(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className={s.dropTarget}
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                {busy ? <Loader2 className={s.spin} size={20} /> : <ImageUp size={20} />}
                <span className={s.dropTitle}>{t('guard.approve.dropTitle')}</span>
                <span className={s.dropHint}>{t('guard.approve.dropHint')}</span>
              </button>
            </div>
          )}

          {source === 'screen' && <ScreenScanner onFound={useDecoded} disabled={busy} />}
        </>
      )}

      {stage.kind === 'preview' && (
        <>
          <ModalHint>{t('guard.approve.reviewHint')}</ModalHint>

          {detail(Wifi, t('guard.approve.ip'), stage.info.ip || t('guard.approve.unknown'))}
          {detail(MapPin, t('guard.approve.location'), location(stage.info))}
          {detail(
            Monitor,
            t('guard.approve.device'),
            stage.info.deviceFriendlyName || t('guard.approve.unknown'),
          )}

          {/* Под фактами, а не над ними: сначала то, что Steam сказал, потом — чем это подозрительно. */}
          {(stage.info.locationMismatch || stage.info.highUsageLogin) && (
            <ModalWarn>
              {stage.info.locationMismatch
                ? t('guard.approve.locationMismatch')
                : t('guard.approve.highUsage')}
            </ModalWarn>
          )}
        </>
      )}

      {stage.kind === 'done' && (
        <ModalStatus
          tone={stage.approved ? 'ok' : 'warn'}
          title={stage.approved ? t('guard.approve.approved') : t('guard.approve.denied')}
        />
      )}

      <ModalError>{error}</ModalError>
    </Modal>
  );
};

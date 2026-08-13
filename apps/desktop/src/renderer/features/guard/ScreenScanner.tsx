import type { ScreenCapture } from '@shared-types';
import { Monitor, ScanLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { ModalError, ModalHint } from '~/widgets/Modal/ModalKit';
import s from './GuardModal.module.scss';
import { type Region, decodeQrFromSource } from './decodeQr';

interface ScreenScannerProps {
  onFound: (payload: string) => void;
  disabled: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'pick'; shots: ScreenCapture[] }
  | { kind: 'crop'; shot: ScreenCapture };

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

/** Reads the login QR straight off the user's screen. */
export const ScreenScanner = ({ onFound, disabled }: ScreenScannerProps) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Rect | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const scan = async () => {
    setPhase({ kind: 'working' });
    setError(null);
    const shots = await window.launcher.steamGuard.screens();
    if (shots.length === 0) {
      setPhase({ kind: 'idle' });
      setError(t('guard.approve.captureFailed'));
      return;
    }
    for (const shot of shots) {
      const payload = await decodeQrFromSource(shot.dataUrl);
      if (payload) {
        setPhase({ kind: 'idle' });
        onFound(payload);
        return;
      }
    }
    setPhase({ kind: 'pick', shots });
    setError(t('guard.approve.qrNotOnScreen'));
  };

  /** Preview pixels → screenshot pixels, so a crop lands where the user drew it. */
  const cropRegion = (image: HTMLImageElement, rect: Rect): Region => {
    const box = image.getBoundingClientRect();
    const scale = image.naturalWidth / box.width;
    return {
      x: Math.round(rect.left * scale),
      y: Math.round(rect.top * scale),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    };
  };

  const finishCrop = async (shot: ScreenCapture, rect: Rect) => {
    const image = imageRef.current;
    // A stray click is not a selection; anything under ~16px cannot hold a QR.
    if (!image || rect.width < 16 || rect.height < 16) return;
    setError(null);
    const payload = await decodeQrFromSource(shot.dataUrl, cropRegion(image, rect));
    if (payload) {
      setPhase({ kind: 'idle' });
      setSel(null);
      onFound(payload);
      return;
    }
    setError(t('guard.approve.qrNotInArea'));
  };

  const pointerPos = (e: React.PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  if (phase.kind === 'crop') {
    const shot = phase.shot;
    return (
      <div className={s.scanner}>
        <ModalHint>{t('guard.approve.cropHint')}</ModalHint>
        <div
          className={s.cropStage}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            origin.current = pointerPos(e);
            setSel(null);
          }}
          onPointerMove={(e) => {
            if (!origin.current) return;
            setSel(rectFrom(origin.current, pointerPos(e)));
          }}
          onPointerUp={(e) => {
            const start = origin.current;
            origin.current = null;
            if (!start) return;
            void finishCrop(shot, rectFrom(start, pointerPos(e)));
          }}
        >
          <img ref={imageRef} className={s.cropImage} src={shot.dataUrl} alt="" draggable={false} />
          {sel && (
            <div
              className={s.cropSelection}
              style={{
                left: `${sel.left}px`,
                top: `${sel.top}px`,
                width: `${sel.width}px`,
                height: `${sel.height}px`,
              }}
            />
          )}
        </div>
        <ModalError>{error}</ModalError>
        <div className={s.row}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSel(null);
              setError(null);
              setPhase({ kind: 'pick', shots: [shot] });
            }}
          >
            {t('guard.approve.back')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void scan()}>
            {t('guard.approve.rescan')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.scanner}>
      <ModalHint>{t('guard.approve.screenExplain')}</ModalHint>

      {phase.kind === 'pick' && (
        <div className={s.shots}>
          {phase.shots.map((shot) => (
            <button
              key={shot.id}
              type="button"
              className={s.shot}
              onClick={() => {
                setError(null);
                setPhase({ kind: 'crop', shot });
              }}
            >
              <img className={s.shotImage} src={shot.dataUrl} alt="" draggable={false} />
              <span className={s.shotName}>
                <Monitor size={12} />
                {shot.name}
              </span>
            </button>
          ))}
        </div>
      )}

      <ModalError>{error}</ModalError>

      <Button
        variant="neutral"
        size="md"
        icon={ScanLine}
        busy={phase.kind === 'working'}
        disabled={disabled}
        onClick={() => void scan()}
      >
        {phase.kind === 'pick' ? t('guard.approve.rescan') : t('guard.approve.scan')}
      </Button>
    </div>
  );
};

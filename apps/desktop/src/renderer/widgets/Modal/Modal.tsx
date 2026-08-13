import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import s from './Modal.module.scss';

/** Три ширины и ни одной больше. */
export type ModalSize = 'sm' | 'md' | 'lg';

const SIZE: Record<ModalSize, string | undefined> = { sm: s.sm, md: s.md, lg: s.lg };

interface ModalProps {
  title: string;
  /** К чему относится диалог: аккаунт, прокси, метка. */
  subtitle?: ReactNode;
  size?: ModalSize;
  /** Полоса кнопок внизу. */
  footer?: ReactNode;
  /** Тело без боковых отступов — для списков, рисующих себя до краёв карточки. */
  flush?: boolean;
  onClose?: () => void;
  closable?: boolean;
  /** Крестик на месте, но пока не нажимается — и вместе с ним Esc и щелчок мимо карточки. */
  closeDisabled?: boolean;
  children: ReactNode;
}

/** What Tab is allowed to reach inside the card. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('hidden') && el.offsetParent !== null,
  );

export const Modal = ({
  title,
  subtitle,
  size = 'md',
  footer,
  flush = false,
  onClose,
  closable = true,
  closeDisabled = false,
  children,
}: ModalProps) => {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);

  /** Единственный ответ на вопрос «закрывается ли оно прямо сейчас». */
  const canClose = closable && !closeDisabled;

  /** Куда вернуть кольцо после закрытия — снято до того, как диалог тронул DOM. */
  const restoreRef = useRef<Element | null>(null);
  if (restoreRef.current === null) restoreRef.current = document.activeElement;

  useEffect(() => {
    if (!canClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canClose, onClose]);

  /** `aria-modal="true"` is a promise to the screen reader that nothing outside this card exists; Tab has to keep it. */
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const restoreTo = restoreRef.current;

    // Поле с `autoFocus` уже забрало кольцо в фазе коммита.
    if (!card.contains(document.activeElement)) (focusableIn(card)[0] ?? card).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusableIn(card);
      // Nothing to move between: the card itself holds the ring and Tab has nowhere to go.
      if (items.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;

      // Also the case where the ring is on the card itself or on something the list no longer contains — both land on an end.
      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    card.addEventListener('keydown', onKeyDown);
    return () => {
      card.removeEventListener('keydown', onKeyDown);
      // Only if it is still on the page: the row the dialog was opened from may have been the account the dialog just deleted.
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) restoreTo.focus();
    };
  }, []);

  const handleBackdrop = (e: React.MouseEvent) => {
    if (!canClose) return;
    if (e.target === e.currentTarget) onClose?.();
  };

  return createPortal(
    <div className={s.backdrop} onClick={handleBackdrop} role="presentation">
      <div
        ref={cardRef}
        className={`${s.card} ${SIZE[size]}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className={s.head}>
          <div className={s.heading}>
            <h2 className={s.title}>{title}</h2>
            {subtitle !== undefined && subtitle !== null && subtitle !== '' && (
              <p className={s.subtitle}>{subtitle}</p>
            )}
          </div>
          {closable && (
            <button
              type="button"
              className={s.close}
              onClick={onClose}
              disabled={closeDisabled}
              aria-label={t('common.close')}
            >
              <X size={16} />
            </button>
          )}
        </header>
        <div className={`${s.body} ${flush ? s.bodyFlush : ''}`}>{children}</div>
        {footer !== undefined && footer !== null && footer !== false && (
          <footer className={s.foot}>{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
};

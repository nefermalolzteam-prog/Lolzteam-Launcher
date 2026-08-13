import {
  type ReactElement,
  type ReactNode,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import s from './Tooltip.module.scss';

type Placement = 'top' | 'bottom';

interface TooltipProps {
  label: ReactNode;
  children: ReactElement;
  placement?: Placement;
  delay?: number;
  disabled?: boolean;
}

const GAP = 8;
const EDGE = 8;
/** Mirrors `$duration-fast`, the length of the `tooltip-out` keyframes. */
const LEAVE_MS = 120;

interface Pos {
  left: number;
  top: number;
  placement: Placement;
}

/** `hidden` is not rendered at all; `leaving` still is, for exactly as long as the fade-out runs. */
type Phase = 'hidden' | 'shown' | 'leaving';

export const Tooltip = ({
  label,
  children,
  placement = 'top',
  delay = 200,
  disabled = false,
}: TooltipProps) => {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const enterRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<Phase>('hidden');
  const [pos, setPos] = useState<Pos | null>(null);

  const clearTimers = () => {
    if (enterRef.current) clearTimeout(enterRef.current);
    if (leaveRef.current) clearTimeout(leaveRef.current);
    enterRef.current = null;
    leaveRef.current = null;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup; clearTimers touches only refs
  useEffect(() => () => clearTimers(), []);

  const show = () => {
    if (disabled) return;
    clearTimers();
    enterRef.current = setTimeout(() => setPhase('shown'), delay);
  };

  const hide = () => {
    clearTimers();
    // A bubble that never made it onto the screen has nothing to fade.
    setPhase((p) => (p === 'shown' ? 'leaving' : 'hidden'));
    leaveRef.current = setTimeout(() => {
      setPhase('hidden');
      setPos(null);
    }, LEAVE_MS);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `label` changes the bubble size — reposition when it changes
  useLayoutEffect(() => {
    if (phase !== 'shown') return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;

    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();

    let side: Placement = placement;
    if (side === 'top' && a.top - GAP - b.height < EDGE) side = 'bottom';
    else if (side === 'bottom' && a.bottom + GAP + b.height > window.innerHeight - EDGE)
      side = 'top';

    const top = side === 'top' ? a.top - GAP - b.height : a.bottom + GAP;

    let left = a.left + a.width / 2 - b.width / 2;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - b.width - EDGE));

    setPos({ left, top, placement: side });
  }, [phase, placement, label]);

  const child = children as ReactElement<{
    ref?: React.Ref<HTMLElement>;
    title?: string;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
    onPointerDown?: (e: React.PointerEvent) => void;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    'aria-describedby'?: string;
  }>;

  const setRef = useCallback(
    (node: HTMLElement | null) => {
      anchorRef.current = node;
      const r = (child as { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof r === 'function') r(node);
      else if (r && typeof r === 'object')
        (r as React.MutableRefObject<HTMLElement | null>).current = node;
    },
    [child],
  );

  const trigger = cloneElement(child, {
    ref: setRef,
    /** The bubble is the tooltip; the browser's own must not double it. */
    title: '',
    onMouseEnter: (e: React.MouseEvent) => {
      child.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      child.props.onMouseLeave?.(e);
      hide();
    },
    onPointerDown: (e: React.PointerEvent) => {
      child.props.onPointerDown?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      child.props.onFocus?.(e);
      // Only a keyboard focus is worth a bubble, and `:focus-visible` is the browser's own answer to which focus that was.
      const anchor = anchorRef.current;
      if (!anchor || !anchor.matches(':focus-visible')) return;
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      child.props.onBlur?.(e);
      hide();
    },
    'aria-describedby': phase === 'shown' ? id : undefined,
  });

  return (
    <>
      {trigger}
      {phase !== 'hidden' &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className={`${s.tooltip} ${pos ? s.visible : ''} ${phase === 'leaving' ? s.leaving : ''} ${
              pos?.placement === 'bottom' ? s.bottom : s.top
            }`}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          >
            {label}
            <span className={s.arrow} aria-hidden />
          </div>,
          document.body,
        )}
    </>
  );
};

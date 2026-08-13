import { type RefObject, useEffect, useRef } from 'react';

/** Closes a popup on an outside pointer press or on Escape. */
export const useDismiss = <T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onDismiss: () => void,
): RefObject<T | null> => {
  const ref = useRef<T>(null);
  // Held in a ref so callers can pass an inline arrow without re-binding the document listeners on every render.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) dismiss.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      dismiss.current();
      // The popup eats the key it acted on.
      e.stopPropagation();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return ref;
};

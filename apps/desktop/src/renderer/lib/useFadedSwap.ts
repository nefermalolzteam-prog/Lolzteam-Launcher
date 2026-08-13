import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Long enough to read as a fade, short enough that the swap still feels pressed. */
const FADE_OUT = 110;
const FADE_IN = 190;
const EASE_IN = 'cubic-bezier(0.16, 1, 0.3, 1)';

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Holds a value back until the element showing it has faded out, applies it while nothing is visible. */
export const useFadedSwap = <T>(value: T, ref: RefObject<HTMLElement | null>): T => {
  const [shown, setShown] = useState(value);
  // The two halves of a swap, kept apart: the fade-out is the one that may have to be undone.
  const fadeOut = useRef<Animation | null>(null);
  const fadeIn = useRef<Animation | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (Object.is(shown, value)) {
      // Switched back before the fade-out finished.
      if (fadeOut.current) {
        fadeOut.current.cancel();
        fadeOut.current = null;
        if (node) node.style.pointerEvents = '';
      }
      return;
    }
    if (!node || reducedMotion()) {
      setShown(value);
      return;
    }
    fadeIn.current?.cancel();
    fadeOut.current?.cancel();
    // Invisible and unclickable are the same thing here: for the moment it is fading.
    node.style.pointerEvents = 'none';
    const out = node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: FADE_OUT,
      easing: 'ease-out',
      // Held at zero until the swap has rendered.
      fill: 'forwards',
    });
    fadeOut.current = out;
    let live = true;
    out.finished.then(() => live && setShown(value)).catch(() => {});
    return () => {
      live = false;
    };
  }, [value, shown, ref]);

  const painted = useRef(shown);
  useLayoutEffect(() => {
    if (Object.is(painted.current, shown)) return;
    painted.current = shown;
    // Cancelling drops the fade-out's `forwards` fill; the fade-in below starts in the same frame.
    fadeOut.current?.cancel();
    fadeOut.current = null;
    const node = ref.current;
    if (!node) return;
    node.style.pointerEvents = '';
    fadeIn.current = node.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_IN,
      easing: EASE_IN,
    });
  }, [shown, ref]);

  return shown;
};

import type { RefObject } from 'react';
import { useLayoutEffect, useState } from 'react';

/** How many columns `repeat(auto-fill, minmax(<min>px, 1fr))` would lay out at the element's current width. */
export const useGridColumns = (ref: RefObject<HTMLElement | null>, min = 320, gap = 8): number => {
  const [cols, setCols] = useState(1);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const apply = (width: number) => {
      setCols(Math.max(1, Math.floor((width + gap) / (min + gap))));
    };

    apply(node.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) apply(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, min, gap]);

  return cols;
};

import type { PointerEvent } from 'react';

/** A `title` for text that is cut with an ellipsis — and only while it really is cut. */
export const titleWhenClipped = (e: PointerEvent<HTMLElement>): void => {
  const el = e.currentTarget;
  // A pixel of tolerance: sub-pixel text widths round up and would otherwise report an untouched label as clipped.
  if (el.scrollWidth > el.clientWidth + 1) el.title = el.textContent ?? '';
  else el.removeAttribute('title');
};

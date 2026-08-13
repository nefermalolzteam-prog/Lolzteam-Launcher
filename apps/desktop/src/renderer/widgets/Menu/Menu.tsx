import {
  type PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import s from './Menu.module.scss';

export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

interface MenuContextValue {
  close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export const useMenuClose = (): (() => void) => {
  const ctx = useContext(MenuContext);
  if (!ctx) throw new Error('MenuItem must be rendered inside a <Menu>');
  return ctx.close;
};

const PLACEMENT_CLASS: Record<MenuPlacement, string | undefined> = {
  'bottom-start': s.bottomStart,
  'bottom-end': s.bottomEnd,
  'top-start': s.topStart,
  'top-end': s.topEnd,
};

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

/** The offset between the button and the menu, mirroring the `calc(100% + 8px)` in the stylesheet. */
const GAP = 8;
/** Breathing space kept between a clamped menu and the edge it was clamped against. */
const EDGE = 8;
/** Below this a scrolling menu is more frustrating than a clipped one. */
const MIN_HEIGHT = 120;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The box the menu has to stay inside: the window, cut down by every ancestor that clips its overflow. */
const clipBox = (el: HTMLElement): Box => {
  const box: Box = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const r = p.getBoundingClientRect();
    box.top = Math.max(box.top, r.top);
    box.bottom = Math.min(box.bottom, r.bottom);
    box.left = Math.max(box.left, r.left);
    box.right = Math.min(box.right, r.right);
  }
  return box;
};

interface Layout {
  placement: MenuPlacement;
  /** Set only when the menu does not fit on the side it ended up on. */
  maxHeight: number | undefined;
}

/** Where the menu actually goes. */
const resolve = (menu: HTMLElement, preferred: MenuPlacement): Layout => {
  const anchor = (menu.offsetParent ?? menu.parentElement) as HTMLElement | null;
  if (!anchor) return { placement: preferred, maxHeight: undefined };

  const a = anchor.getBoundingClientRect();
  const box = clipBox(menu);
  // `offsetHeight` is the box as it stands, which on a re-measure is already clamped by the `maxHeight` of the previous.
  const height = menu.scrollHeight + (menu.offsetHeight - menu.clientHeight);
  const width = menu.offsetWidth;

  const [side, align] = preferred.split('-') as ['top' | 'bottom', 'start' | 'end'];
  const room = { top: a.top - box.top - GAP, bottom: box.bottom - a.bottom - GAP };
  const otherSide = side === 'top' ? 'bottom' : 'top';
  const vertical =
    height <= room[side]
      ? side
      : height <= room[otherSide]
        ? otherSide
        : room[side] >= room[otherSide]
          ? side
          : otherSide;

  // `start` hangs off the left edge of the button and grows right, `end` the mirror of it.
  const fits = { start: a.left + width <= box.right, end: a.right - width >= box.left };
  const otherAlign = align === 'start' ? 'end' : 'start';
  const horizontal = fits[align] ? align : fits[otherAlign] ? otherAlign : align;

  return {
    placement: `${vertical}-${horizontal}`,
    maxHeight: height > room[vertical] ? Math.max(MIN_HEIGHT, room[vertical] - EDGE) : undefined,
  };
};

interface MenuProps {
  open: boolean;
  onClose: () => void;
  placement?: MenuPlacement;
  label?: string;
  className?: string;
}

export const Menu = ({
  open,
  onClose,
  placement = 'bottom-end',
  label,
  className,
  children,
}: PropsWithChildren<MenuProps>) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Before paint, so the menu is never seen on the side it could not use.
  useLayoutEffect(() => {
    if (!open) {
      setLayout(null);
      return;
    }
    const el = listRef.current;
    if (!el) return;
    const apply = () => setLayout(resolve(el, placement));
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
        return;
      }
      const all = listRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [];
      const items = [...all].filter((el) => !el.hasAttribute('disabled'));
      if (items.length === 0) return;
      e.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLElement);
      const last = items.length - 1;
      let next: number;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      else if (e.key === 'ArrowDown') next = at < 0 || at === last ? 0 : at + 1;
      else next = at <= 0 ? last : at - 1;
      items[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <MenuContext.Provider value={{ close: () => close.current() }}>
      <div
        ref={listRef}
        role="menu"
        aria-label={label}
        className={`${s.menu} ${PLACEMENT_CLASS[layout?.placement ?? placement] ?? ''} ${className ?? ''}`}
        style={layout?.maxHeight ? { maxHeight: layout.maxHeight } : undefined}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
};

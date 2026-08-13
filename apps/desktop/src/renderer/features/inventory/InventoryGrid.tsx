import type { AccountSummary } from '@shared-types';
import { isLocalAccount } from '@shared-types';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGridColumns } from '~/lib/useGridColumns';
import { useInventoryReveal } from '~/stores/inventoryReveal';
import { useScrollRoot } from '~/widgets/Shell/scrollRoot';
import { AccountCard } from './AccountCard';
import { SkeletonCard, SkeletonRow } from './InventorySkeleton';
import s from './InventoryView.module.scss';

interface InventoryGridProps {
  items: AccountSummary[];
  /** Table layout instead of the card grid — one account per row. */
  table: boolean;
  selectionOn: boolean;
  candidateIds: ReadonlySet<number>;
  selectedIds: ReadonlySet<number>;
  /** All three must be stable, or `memo` on `AccountCard` buys nothing. */
  onSelect: (item: AccountSummary) => void;
  onEdit: (item: AccountSummary) => void;
  onDelete: (item: AccountSummary) => void;
  /** How many placeholders to draw after the loaded accounts while more are still streaming in. */
  pending?: number;
}

/** Row height before the first real measurement — only the scrollbar sees it. */
const ESTIMATE_ROW = 76;
const ESTIMATE_CARD = 300;

/** The windowed account list. */
export const InventoryGrid = ({
  items,
  table,
  selectionOn,
  candidateIds,
  selectedIds,
  onSelect,
  onEdit,
  onDelete,
  pending = 0,
}: InventoryGridProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRoot = useScrollRoot();
  const measuredCols = useGridColumns(containerRef);
  const cols = table ? 1 : measuredCols;
  // Placeholders are counted into the window rather than appended after it.
  const total = items.length + pending;
  const rowCount = Math.ceil(total / cols);

  // The list does not start at the top of the scroll container — a sticky header, and sometimes a notice, sit above it.
  const marginRef = useRef(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  const measureMargin = useCallback(() => {
    const node = containerRef.current;
    if (!node || !scrollRoot) return;
    const next =
      node.getBoundingClientRect().top -
      scrollRoot.getBoundingClientRect().top +
      scrollRoot.scrollTop;
    // A sub-pixel difference is measurement noise; acting on it would be a render loop that never settles.
    if (Math.abs(next - marginRef.current) < 1) return;
    marginRef.current = next;
    setScrollMargin(next);
  }, [scrollRoot]);

  useLayoutEffect(measureMargin);
  useLayoutEffect(() => {
    if (!scrollRoot) return;
    const observer = new ResizeObserver(measureMargin);
    observer.observe(scrollRoot);
    return () => observer.disconnect();
  }, [scrollRoot, measureMargin]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRoot,
    estimateSize: () => (table ? ESTIMATE_ROW : ESTIMATE_CARD),
    overscan: table ? 8 : 3,
    scrollMargin,
    // Rows are measured from a `ref` callback, which React runs inside its own commit.
    useFlushSync: false,
  });

  const virtualRows = virtualizer.getVirtualItems();

  // Which account is at the top of the viewport, so a layout change can put the user back on it.
  const anchorRef = useRef(0);
  useEffect(() => {
    const offset = virtualizer.scrollOffset ?? 0;
    const first = virtualRows.find((row) => row.end > offset) ?? virtualRows[0];
    if (first) anchorRef.current = first.index * cols;
  });

  const layoutRef = useRef({ table, cols });
  useLayoutEffect(() => {
    const prev = layoutRef.current;
    if (prev.table === table && prev.cols === cols) return;
    layoutRef.current = { table, cols };
    // Heights measured for the old layout say nothing about the new one.
    virtualizer.measure();
    if (anchorRef.current > 0) {
      virtualizer.scrollToIndex(Math.floor(anchorRef.current / cols), { align: 'start' });
    }
  }, [table, cols, virtualizer]);

  /** Одна строка, о которой попросили извне, — на экран. */
  const revealId = useInventoryReveal((st) => st.itemId);
  const revealNonce = useInventoryReveal((st) => st.nonce);
  const revealedRef = useRef('');
  useEffect(() => {
    if (revealId === null) return;
    const stamp = `${revealNonce}:${scrollMargin}:${cols}`;
    if (revealedRef.current === stamp) return;
    // Не нашёлся — не помечаем: аккаунт может ещё стримиться, и тогда этот же эффект доведёт до него, когда `items` обновится.
    const index = items.findIndex((it) => it.itemId === revealId);
    if (index < 0) return;
    revealedRef.current = stamp;
    virtualizer.scrollToIndex(Math.floor(index / cols), { align: 'center' });
  }, [revealId, revealNonce, scrollMargin, cols, items, virtualizer]);

  const renderCard = (item: AccountSummary, index: number) => {
    const selectable = selectionOn && candidateIds.has(item.itemId);
    const selected = selectedIds.has(item.itemId);
    return isLocalAccount(item) ? (
      <AccountCard
        key={item.itemId}
        item={item}
        index={index}
        asRow={table}
        selectable={selectable}
        selected={selected}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    ) : (
      <AccountCard
        key={item.itemId}
        item={item}
        index={index}
        asRow={table}
        selectable={selectable}
        selected={selected}
        onSelect={onSelect}
      />
    );
  };

  // Card rows need nothing beyond the grid; table rows carry the separators and the rounded ends the list as a whole used.
  const rowClass = (index: number) => {
    const last = index === rowCount - 1;
    if (!table) return `${s.gridRow} ${s.cardRow} ${last ? s.cardRowLast : ''}`;
    return [
      s.gridRow,
      s.tableRow,
      index === 0 ? s.tableRowFirst : s.tableRowSep,
      last ? s.tableRowLast : '',
    ]
      .filter(Boolean)
      .join(' ');
  };

  // `--cols` drives the row template; it is inline because only JS knows how many columns the measured width allows.
  const colsVar = { '--cols': cols } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className={s.grid}
      style={{ ...colsVar, height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualRows.map((row) => {
        const start = row.index * cols;
        const end = Math.min(start + cols, total);
        // A row can straddle the boundary: the accounts that are already here, then placeholders for the rest of its columns.
        const loaded = Math.max(start, Math.min(end, items.length));
        return (
          <div
            key={row.key}
            // `data-index` is not decoration: `measureElement` reads the index back off the node it is handed.
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={rowClass(row.index)}
            style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
          >
            {items.slice(start, loaded).map((item, i) => renderCard(item, start + i + 1))}
            {Array.from({ length: end - loaded }, (_, i) =>
              table ? (
                <SkeletonRow key={`ph-${loaded + i}`} />
              ) : (
                <SkeletonCard key={`ph-${loaded + i}`} />
              ),
            )}
          </div>
        );
      })}
    </div>
  );
};

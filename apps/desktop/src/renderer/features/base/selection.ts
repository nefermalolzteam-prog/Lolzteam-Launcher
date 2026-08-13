import type { AccountSummary } from '@shared-types';

export type MassService = 'telegram' | 'steam';

export interface MassSelection {
  /** The selected accounts, in the order the grid draws them. */
  readonly items: readonly AccountSummary[];
  readonly ids: readonly number[];
  /** What the counter shows, and what a run will be handed. */
  readonly count: number;
  /** The one service every selected account belongs to, `null` when they belong to two. */
  readonly service: MassService | null;
  readonly mixed: boolean;
}

const serviceOf = (item: AccountSummary): MassService =>
  item.category === 'steam' ? 'steam' : 'telegram';

/** Which service a mass run would treat this account as. */
export const massServiceOf = serviceOf;

export const massSelection = (
  candidates: readonly AccountSummary[],
  ids: ReadonlySet<number>,
): MassSelection => {
  const items = candidates.filter((it) => ids.has(it.itemId));
  let service: MassService | null = null;
  for (const it of items) {
    const kind = serviceOf(it);
    if (service && service !== kind) {
      service = null;
      break;
    }
    service = kind;
  }
  return {
    items,
    ids: items.map((it) => it.itemId),
    count: items.length,
    service,
    mixed: items.length > 0 && service === null,
  };
};

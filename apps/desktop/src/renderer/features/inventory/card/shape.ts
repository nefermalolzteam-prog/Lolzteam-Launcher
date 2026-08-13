import type { AccountSummary } from '@shared-types';
import type { AccountControls } from './controls';
import type { AccountFacts } from './facts';

/** What a shape is given. */
export interface AccountShapeProps {
  readonly facts: AccountFacts;
  readonly controls: AccountControls;
  /** 1-based position in the list, drawn in the leading column of a row when there is no checkbox to put there. */
  readonly index?: number;
  readonly selectable: boolean;
  readonly selected: boolean;
  readonly onSelect?: (item: AccountSummary) => void;
  /** Present only for local accounts — the market has no editing here. */
  readonly onEdit?: (item: AccountSummary) => void;
  readonly onDelete?: (item: AccountSummary) => void;
}

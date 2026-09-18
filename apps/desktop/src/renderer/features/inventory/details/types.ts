import type { AccountSummary } from '@shared-types';
import type { AccountControls } from '../card/controls';

/** Every per-service detail panel takes the whole item, not its service slice. */
export interface AccountDetailsProps {
  item: AccountSummary;
  compact: boolean;
  /**
   * Only for the rare badge that does something instead of merely stating a
   * fact — most panels never touch it.
   */
  controls?: AccountControls;
}

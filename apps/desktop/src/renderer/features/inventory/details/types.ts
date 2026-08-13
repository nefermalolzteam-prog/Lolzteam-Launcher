import type { AccountSummary } from '@shared-types';

/** Every per-service detail panel takes the whole item, not its service slice. */
export interface AccountDetailsProps {
  item: AccountSummary;
  compact: boolean;
}

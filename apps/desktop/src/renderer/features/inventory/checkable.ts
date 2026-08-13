import { type AccountSummary, isLocalAccount } from '@shared-types';

/** Can a mass run reach this account at all? */
export const isCheckable = (item: AccountSummary): boolean =>
  isLocalAccount(item) && (item.category === 'telegram' || item.category === 'steam');

import type { AccountSummary } from '@shared-types';
import {
  LOGIN_METHODS_BY_FLOW,
  defaultLoginMethodOf,
  loginFlowOf,
  loginMethodsOf,
} from '@shared-types';
import type { LoginMethod, LoginService } from '~/stores/loginSession';

/** Category → login flow. */
export const toLoginService = (category: AccountSummary['category']): LoginService | null =>
  loginFlowOf(category);

export const loginMethodFor = (service: LoginService): LoginMethod => defaultLoginMethodOf(service);

export const loginMethodsFor = (service: LoginService): readonly LoginMethod[] =>
  LOGIN_METHODS_BY_FLOW[service] ?? [defaultLoginMethodOf(service)];

/** Login methods for a market category, skipping the flow indirection. */
export const loginMethodsForCategory = (
  category: AccountSummary['category'],
): readonly LoginMethod[] => loginMethodsOf(category);

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export const formatWarranty = (warrantyEndsAt: number | null, t: TFunc): string | null => {
  if (!warrantyEndsAt) return null;
  const ms = warrantyEndsAt * 1000 - Date.now();
  if (ms <= 0) return null;
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return t('inventory.card.warrantyDays', { count: days });
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return t('inventory.card.warrantyHours', { count: hours });
};

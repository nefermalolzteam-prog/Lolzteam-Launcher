import type { ComponentType } from 'react';
import type { MassActionId } from '~/stores/inventorySelection';
import {
  EraserIcon,
  EyeIcon,
  PlusCircleIcon,
  RefreshIcon,
  UserCircleIcon,
  UserIcon,
} from '~/widgets/icons/Icons';
import type { MassService } from './selection';

/** What a row may hang on itself: anything that draws at a size it is told. */
export type MassActionIcon = ComponentType<{ size?: number | string }>;

export interface MassAction {
  readonly id: MassActionId;
  readonly icon: MassActionIcon;
  /** The services this operation exists for. */
  readonly services: readonly MassService[];
  /** Set when the operation is listed but not implemented. */
  readonly soon?: true;
  /** The one operation the bar draws in the accent colour. */
  readonly lead?: true;
}

export const MASS_ACTIONS: readonly MassAction[] = [
  { id: 'check', icon: RefreshIcon, services: ['telegram', 'steam'], lead: true },
  { id: 'profile', icon: UserCircleIcon, services: ['telegram'] },
  { id: 'cleanup', icon: EraserIcon, services: ['telegram'] },
  /** The eye that the account's own facts already use for «профиль открыт»: this run is what decides that badge. */
  { id: 'privacy', icon: EyeIcon, services: ['telegram'] },
  /** Steam only because Telegram has no such thing, not because the account was bought locally. */
  { id: 'friends', icon: UserIcon, services: ['steam'] },
  /** Attaching the authenticator, and the one row here whose `services` is a narrower claim than it looks. */
  { id: 'link', icon: PlusCircleIcon, services: ['steam'] },
];

/** Whether an action can be started on the current selection, and — when it cannot — the translation key that explains why. */
export interface MassActionState {
  /** Whether the action belongs in the bar at all. */
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly reasonKey: string | null;
}

export const massActionState = (
  action: MassAction,
  service: MassService | null,
  mixed: boolean,
): MassActionState => {
  if (mixed) return { visible: true, enabled: false, reasonKey: 'base.mixedServices' };
  if (action.soon) return { visible: true, enabled: false, reasonKey: 'base.soon' };
  // Nothing selected yet: the button is disabled by the count.
  if (service === null) return { visible: true, enabled: false, reasonKey: null };
  if (action.services.includes(service)) return { visible: true, enabled: true, reasonKey: null };
  // Named by the service it does belong to, and only when there is one to name; «Telegram only» is information.
  const only = action.services.length === 1 ? action.services[0] : null;
  return {
    visible: false,
    enabled: false,
    reasonKey: only ? `base.only.${only}` : 'base.soon',
  };
};

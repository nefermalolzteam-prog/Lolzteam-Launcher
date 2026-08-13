import { type ReactNode, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

/** Слот действий в шапке страницы настроек. */
const PageActionsSlot = createContext<HTMLElement | null>(null);

export const PageActionsSlotProvider = PageActionsSlot.Provider;

export const SettingsPageActions = ({ children }: { children: ReactNode }) => {
  const slot = useContext(PageActionsSlot);
  // Первый рендер страницы случается до того, как ref шапки доедет до состояния, — тогда рисовать некуда.
  return slot ? createPortal(children, slot) : null;
};

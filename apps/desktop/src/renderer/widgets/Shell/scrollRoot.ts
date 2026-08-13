import { createContext, useContext } from 'react';

/** The one element in the app that scrolls: `<main>` inside `Shell`. */
const ScrollRootContext = createContext<HTMLElement | null>(null);

export const ScrollRootProvider = ScrollRootContext.Provider;

export const useScrollRoot = (): HTMLElement | null => useContext(ScrollRootContext);

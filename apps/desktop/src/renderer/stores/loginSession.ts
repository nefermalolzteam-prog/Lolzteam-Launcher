import type { LoginStep } from '@adapter-contract';
import type { LoginFlow, LoginMethod } from '@shared-types';
import { create } from 'zustand';

/** The login pipeline the progress modal renders. */
export type LoginService = LoginFlow;
export type { LoginMethod };

interface LoginSessionState {
  itemId: number | null;
  accountTitle: string;
  service: LoginService | null;
  method: LoginMethod;
  step: LoginStep | null;
  detail: string | undefined;
  error: string | null;
  isOpen: boolean;
  start: (itemId: number, title: string, service: LoginService, method?: LoginMethod) => void;
  setStep: (step: LoginStep, detail?: string) => void;
  fail: (error: string) => void;
  close: () => void;
}

export const useLoginSession = create<LoginSessionState>((set) => ({
  itemId: null,
  accountTitle: '',
  service: null,
  method: 'native',
  step: null,
  detail: undefined,
  error: null,
  isOpen: false,
  start: (itemId, title, service, method = 'native') =>
    set({
      itemId,
      accountTitle: title,
      service,
      method,
      step: 'fetching-credentials',
      detail: undefined,
      error: null,
      isOpen: true,
    }),
  setStep: (step, detail) => set({ step, detail }),
  fail: (error) => set({ error }),
  close: () =>
    set({
      itemId: null,
      accountTitle: '',
      service: null,
      method: 'native',
      step: null,
      detail: undefined,
      error: null,
      isOpen: false,
    }),
}));

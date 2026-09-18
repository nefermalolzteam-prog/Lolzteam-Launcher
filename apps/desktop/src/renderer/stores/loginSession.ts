import type { LocalizedText, LoginDetail, LoginStep } from '@adapter-contract';
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
  detailKey: LoginDetail | undefined;
  error: LocalizedText | null;
  isOpen: boolean;
  start: (itemId: number, title: string, service: LoginService, method?: LoginMethod) => void;
  setStep: (step: LoginStep, detailKey?: LoginDetail) => void;
  fail: (error: LocalizedText) => void;
  close: () => void;
}

export const useLoginSession = create<LoginSessionState>((set) => ({
  itemId: null,
  accountTitle: '',
  service: null,
  method: 'native',
  step: null,
  detailKey: undefined,
  error: null,
  isOpen: false,
  start: (itemId, title, service, method = 'native') =>
    set({
      itemId,
      accountTitle: title,
      service,
      method,
      step: 'fetching-credentials',
      detailKey: undefined,
      error: null,
      isOpen: true,
    }),
  setStep: (step, detailKey) => set({ step, detailKey }),
  fail: (error) => set({ error }),
  close: () =>
    set({
      itemId: null,
      accountTitle: '',
      service: null,
      method: 'native',
      step: null,
      detailKey: undefined,
      error: null,
      isOpen: false,
    }),
}));

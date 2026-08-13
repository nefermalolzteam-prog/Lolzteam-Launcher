import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderOptions, type RenderResult, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { i18n } from '~/i18n';

/** A client per render, and one that gives up immediately. */
const testQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

export interface RenderWithProviders extends RenderResult {
  /** The client behind the render, for a test that needs to seed or read the cache. */
  queryClient: QueryClient;
}

export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderWithProviders => {
  const queryClient = testQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
  return { ...render(ui, { ...options, wrapper: Wrapper }), queryClient };
};

/** The dictionary the tests read their expected strings out of. */
export const t = i18n.t.bind(i18n);

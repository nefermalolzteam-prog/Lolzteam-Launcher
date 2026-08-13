import { LLM_SERVICE_LABELS, type LlmServiceId, detectLlmService } from '@shared-types';
import type { AccountDetails } from '@shared-types';

export type LlmProvider = LlmServiceId;
export type LlmLoginKind = 'session-cookie' | 'browser-cookie' | 'email-fill';

export interface LlmProviderConfig {
  provider: LlmProvider;
  displayName: string;
  loginKind: LlmLoginKind;
  /** session-cookie only: cookie domain (leading dot = all subdomains) + name. */
  cookieDomain?: string;
  cookieName?: string;
  landingUrl?: string;
  autofillHosts?: readonly string[];
}

type LlmProviderSpec = Omit<LlmProviderConfig, 'provider' | 'displayName'>;

const SPECS: Record<LlmProvider, LlmProviderSpec> = {
  claude: {
    loginKind: 'session-cookie',
    cookieDomain: '.claude.ai',
    cookieName: 'sessionKey',
    landingUrl: 'https://claude.ai/login',
  },
  grok: {
    loginKind: 'browser-cookie',
    landingUrl: 'https://accounts.x.ai/sign-in/',
  },
  cursor: {
    loginKind: 'browser-cookie',
    landingUrl: 'https://cursor.com/',
  },
  chatgpt: {
    loginKind: 'email-fill',
    landingUrl: 'https://chatgpt.com/',
    autofillHosts: ['openai.com', 'chatgpt.com'],
  },
};

const PROVIDERS: Record<LlmProvider, LlmProviderConfig> = Object.fromEntries(
  (Object.keys(SPECS) as LlmProvider[]).map((provider) => [
    provider,
    { ...SPECS[provider], provider, displayName: LLM_SERVICE_LABELS[provider] },
  ]),
) as Record<LlmProvider, LlmProviderConfig>;

export const resolveLlmProvider = (details: AccountDetails): LlmProviderConfig | null => {
  const id =
    details.llmService ??
    detectLlmService(details.title, details.categoryTitle, details.description);
  return id ? PROVIDERS[id] : null;
};

export interface LlmServiceDefinition {
  readonly displayName: string;
  /** Has a working login path. */
  readonly supported: boolean;
  /** Unambiguous substrings matched (lowercased) against an item's title, category and description. */
  readonly keywords: readonly string[];
  /** Substrings that could plausibly appear in another provider's listing. */
  readonly weakKeywords?: readonly string[];
  /** Plan codes the market ships for this provider, mapped to the market's own label. */
  readonly plans?: Readonly<Record<string, string>>;
  /** File name (without extension) in `renderer/assets/category/`. */
  readonly icon: string;
}

/** Declaration order drives both the UI filter order and detection priority. */
export const LLM_SERVICE_DEFINITIONS = {
  claude: {
    displayName: 'Claude',
    supported: true,
    keywords: ['claude'],
    plans: {
      claude_pro: 'Claude Pro',
      claude_max_5x: 'Claude Max 5x',
      claude_max_20x: 'Claude Max 20x',
      claude_raven: 'Claude Team',
    },
    icon: 'claude',
  },
  chatgpt: {
    displayName: 'ChatGPT',
    supported: true,
    keywords: ['chatgpt'],
    weakKeywords: ['openai', 'gpt'],
    plans: {
      chatgptplusplan: 'ChatGPT Plus',
      chatgptpro: 'ChatGPT Pro',
      chatgptprolite: 'ChatGPT Pro Lite',
      chatgptenterpriseplan: 'ChatGPT Enterprise',
      chatgpteduplan: 'ChatGPT Edu',
      chatgptquorumplan: 'ChatGPT Quorum',
      chatgptgoplan: 'ChatGPT Go',
    },
    icon: 'chatgpt',
  },
  cursor: {
    displayName: 'Cursor',
    supported: true,
    keywords: ['cursor'],
    // Cursor's codes are built from whatever Stripe calls the plan.
    plans: {
      cursor_pro: 'Cursor Pro',
      cursor_pro_plus: 'Cursor Pro Plus',
      cursor_enterprise: 'Cursor Enterprise',
      cursor_ultra: 'Cursor Ultra',
    },
    icon: 'cursor',
  },
  grok: {
    displayName: 'Grok',
    supported: true,
    keywords: ['grok'],
    plans: {
      grok_super_lite: 'SuperGrok Lite',
      grok_pro: 'SuperGrok',
      grok_super_pro: 'SuperGrok Heavy',
      grok_enterprise: 'Grok Enterprise',
    },
    icon: 'grok',
  },
} as const satisfies Record<string, LlmServiceDefinition>;

export type LlmServiceId = keyof typeof LLM_SERVICE_DEFINITIONS;

/** Widens the `as const` literal back to the interface. */
const definitionOf = (id: LlmServiceId): LlmServiceDefinition => LLM_SERVICE_DEFINITIONS[id];

export const LLM_SERVICES = Object.keys(LLM_SERVICE_DEFINITIONS) as readonly LlmServiceId[];

export const SUPPORTED_LLM_SERVICES: readonly LlmServiceId[] = LLM_SERVICES.filter(
  (id) => definitionOf(id).supported,
);

export const isLlmServiceSupported = (id: LlmServiceId | null | undefined): boolean =>
  id != null && LLM_SERVICE_DEFINITIONS[id] !== undefined && definitionOf(id).supported;

export const LLM_SERVICE_LABELS = Object.fromEntries(
  LLM_SERVICES.map((id) => [id, definitionOf(id).displayName]),
) as Record<LlmServiceId, string>;

export const LLM_SERVICE_ICONS = Object.fromEntries(
  LLM_SERVICES.map((id) => [id, definitionOf(id).icon]),
) as Record<LlmServiceId, string>;

/** Resolves a provider from free-form market text. */
export const detectLlmService = (...parts: (string | null | undefined)[]): LlmServiceId | null => {
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  if (!hay) return null;
  for (const id of LLM_SERVICES) {
    if (definitionOf(id).keywords.some((k) => hay.includes(k))) return id;
  }
  for (const id of LLM_SERVICES) {
    const weak = definitionOf(id).weakKeywords ?? [];
    if (weak.some((k) => hay.includes(k))) return id;
  }
  return null;
};

/** The market's own label for a plan code, if it has one. */
const planFromTable = (service: LlmServiceId | null | undefined, code: string): string | null => {
  if (service) {
    const own = definitionOf(service).plans?.[code];
    if (own) return own;
  }
  for (const id of LLM_SERVICES) {
    const hit = definitionOf(id).plans?.[code];
    if (hit) return hit;
  }
  return null;
};

/** Turns a market plan code into something a person reads. */
export const llmPlanLabel = (
  service: LlmServiceId | null | undefined,
  raw: string | null | undefined,
): string | null => {
  const source = raw?.trim() ?? '';
  if (!source) return null;

  let rest = source.toLowerCase();
  const known = planFromTable(service, rest);
  if (known) return known;

  if (service && rest.startsWith(service)) rest = rest.slice(service.length);
  rest = rest.replace(/^[_\-\s]+/, '');
  if (rest.endsWith('plan') && rest.length > 4) rest = rest.slice(0, -4);
  rest = rest.replace(/[_\-\s]+$/, '');
  if (!rest) return source;

  return rest
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

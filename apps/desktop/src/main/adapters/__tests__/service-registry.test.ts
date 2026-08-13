import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LLM_SERVICES,
  LLM_SERVICE_DEFINITIONS,
  LLM_SERVICE_ICONS,
  LOGIN_METHODS_BY_FLOW,
  type LlmServiceId,
  SERVICE_CATEGORY_ID,
  SERVICE_ICONS,
  SERVICE_IDS,
  SUPPORTED_SERVICE_IDS,
  type ServiceId,
  categoryIdToServiceId,
  categoryNameToServiceId,
  detectLlmService,
  getService,
  isSupportedServiceId,
  llmPlanLabel,
  loginMethodsOf,
  serviceLabel,
} from '@shared-types';
import { describe, expect, it } from 'vitest';

const iconPath = (name: string) =>
  fileURLToPath(new URL(`../../../renderer/assets/category/${name}.svg`, import.meta.url));

describe('service registry', () => {
  it('derives supported services from the presence of a login block', () => {
    for (const id of SERVICE_IDS) {
      expect(isSupportedServiceId(id)).toBe(getService(id).login !== undefined);
    }
    for (const id of SUPPORTED_SERVICE_IDS) {
      expect(SUPPORTED_SERVICE_IDS.includes(id)).toBe(true);
    }
  });

  it('gives every supported service a market category id', () => {
    for (const id of SUPPORTED_SERVICE_IDS) {
      expect(SERVICE_CATEGORY_ID[id], `${id} has no categoryId`).toBeTypeOf('number');
    }
  });

  it('keeps category ids unique', () => {
    const seen = new Map<number, ServiceId>();
    for (const [id, categoryId] of Object.entries(SERVICE_CATEGORY_ID) as [ServiceId, number][]) {
      const clash = seen.get(categoryId);
      expect(clash, `${id} and ${clash} share category id ${categoryId}`).toBeUndefined();
      seen.set(categoryId, id);
    }
  });

  it('round-trips ids and names through the category maps', () => {
    for (const id of SERVICE_IDS) {
      expect(categoryNameToServiceId(id)).toBe(id);
      expect(categoryNameToServiceId(id.toUpperCase())).toBe(id);
      for (const alias of getService(id).aliases ?? []) {
        expect(categoryNameToServiceId(alias), `alias ${alias}`).toBe(id);
      }
      const categoryId = SERVICE_CATEGORY_ID[id];
      if (categoryId !== undefined) expect(categoryIdToServiceId(categoryId)).toBe(id);
    }
  });

  it('never lets an alias shadow another service id', () => {
    for (const id of SERVICE_IDS) {
      for (const alias of getService(id).aliases ?? []) {
        expect(SERVICE_IDS.includes(alias as ServiceId), `alias ${alias} is also an id`).toBe(
          false,
        );
      }
    }
  });

  it('gives every service a non-empty label', () => {
    for (const id of SERVICE_IDS) {
      expect(serviceLabel(id).length).toBeGreaterThan(0);
    }
    expect(serviceLabel(null)).toBe('');
  });

  it('ships an icon file for every declared icon', () => {
    for (const [id, icon] of Object.entries(SERVICE_ICONS)) {
      expect(existsSync(iconPath(icon as string)), `${id}: missing ${icon}.svg`).toBe(true);
    }
    for (const id of LLM_SERVICES) {
      const icon = LLM_SERVICE_ICONS[id];
      expect(existsSync(iconPath(icon)), `${id}: missing ${icon}.svg`).toBe(true);
    }
  });

  it('lists at least one login method per supported service', () => {
    for (const id of SUPPORTED_SERVICE_IDS) {
      expect(loginMethodsOf(id).length, `${id} has no login methods`).toBeGreaterThan(0);
    }
    expect(loginMethodsOf(null)).toEqual([]);
  });

  it('keeps one method list per login flow', () => {
    // Two services sharing a flow but declaring different methods would make `LOGIN_METHODS_BY_FLOW` order-dependent.
    const byFlow = new Map<string, readonly string[]>();
    for (const id of SUPPORTED_SERVICE_IDS) {
      const login = getService(id).login;
      if (!login) continue;
      const known = byFlow.get(login.flow);
      if (known) {
        expect(
          [...login.methods],
          `flow "${login.flow}" declared twice with different methods`,
        ).toEqual([...known]);
      } else {
        byFlow.set(login.flow, login.methods);
      }
      expect(LOGIN_METHODS_BY_FLOW[login.flow]).toEqual(login.methods);
    }
  });
});

describe('LLM plan tables', () => {
  // `llmPlanLabel` falls back to a sweep across every provider when the listing named no service.
  it('never lets two providers claim the same plan code', () => {
    const seen = new Map<string, LlmServiceId>();
    for (const id of LLM_SERVICES) {
      for (const code of Object.keys(LLM_SERVICE_DEFINITIONS[id].plans ?? {})) {
        const clash = seen.get(code);
        expect(clash, `${id} and ${clash} both claim "${code}"`).toBeUndefined();
        seen.set(code, id);
      }
    }
  });

  it('gives every plan a non-empty label', () => {
    for (const id of LLM_SERVICES) {
      for (const [code, label] of Object.entries(LLM_SERVICE_DEFINITIONS[id].plans ?? {})) {
        expect(label.trim().length, `${id}/${code}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('detectLlmService', () => {
  it('matches strong keywords', () => {
    expect(detectLlmService('Claude Pro 1 month')).toBe('claude');
    expect(detectLlmService('ChatGPT Plus')).toBe('chatgpt');
    expect(detectLlmService('Cursor Pro')).toBe('cursor');
    expect(detectLlmService('Grok SuperGrok')).toBe('grok');
  });

  it('falls back to weak keywords only when no strong one hits', () => {
    expect(detectLlmService('OpenAI account')).toBe('chatgpt');
    expect(detectLlmService('GPT-4 access')).toBe('chatgpt');
    // Strong keyword wins over another provider's weak one.
    expect(detectLlmService('Cursor GPT-4')).toBe('cursor');
  });

  it('resolves ties by declaration order', () => {
    expect(detectLlmService('Claude + ChatGPT bundle')).toBe('claude');
  });

  it('is case-insensitive and joins all parts', () => {
    expect(detectLlmService(null, 'CLAUDE', undefined)).toBe('claude');
    expect(detectLlmService('subscription', null, 'claude.ai key')).toBe('claude');
  });

  it('returns null for unknown or empty input', () => {
    expect(detectLlmService('Netflix Premium')).toBeNull();
    expect(detectLlmService(null, undefined, '')).toBeNull();
  });
});

describe('llmPlanLabel', () => {
  // The market's own wording, taken from the forum's per-service plan tables.
  it('answers with the market’s label for the codes it ships', () => {
    expect(llmPlanLabel('claude', 'claude_pro')).toBe('Claude Pro');
    expect(llmPlanLabel('claude', 'claude_raven')).toBe('Claude Team');
    expect(llmPlanLabel('cursor', 'cursor_pro_plus')).toBe('Cursor Pro Plus');
    expect(llmPlanLabel('grok', 'grok_super_lite')).toBe('SuperGrok Lite');
    expect(llmPlanLabel('grok', 'grok_pro')).toBe('SuperGrok');
    expect(llmPlanLabel('grok', 'grok_super_pro')).toBe('SuperGrok Heavy');
    expect(llmPlanLabel('chatgpt', 'chatgptgoplan')).toBe('ChatGPT Go');
    expect(llmPlanLabel('chatgpt', 'chatgptprolite')).toBe('ChatGPT Pro Lite');
  });

  it('finds the label even when the listing named no service', () => {
    expect(llmPlanLabel(null, 'claude_max_20x')).toBe('Claude Max 20x');
  });

  // Cursor assembles its codes out of the billing plan name.
  it('derives a label for a code the table has never seen', () => {
    expect(llmPlanLabel('cursor', 'cursor_teams')).toBe('Teams');
    expect(llmPlanLabel('grok', 'grok_ludicrous')).toBe('Ludicrous');
    expect(llmPlanLabel(null, 'super_lite')).toBe('Super Lite');
    // Nothing to strip the prefix with, so it stays — still better than a blank.
    expect(llmPlanLabel(null, 'someai_pro')).toBe('Someai Pro');
  });

  it('keeps the raw code when stripping would leave nothing', () => {
    expect(llmPlanLabel('claude', 'claude')).toBe('claude');
    expect(llmPlanLabel('chatgpt', 'plan')).toBe('Plan');
  });

  it('has nothing to say about an absent plan', () => {
    expect(llmPlanLabel('claude', null)).toBeNull();
    expect(llmPlanLabel('claude', '   ')).toBeNull();
  });
});

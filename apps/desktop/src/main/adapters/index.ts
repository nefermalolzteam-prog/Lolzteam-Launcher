import type { ServiceAdapter } from '@adapter-contract';
import type { ServiceId, SupportedServiceId } from '@shared-types';
import { instagramAdapter, tiktokAdapter } from './browser/adapter';
import { discordAdapter } from './discord/adapter';
import { llmAdapter } from './llm/adapter';
import { steamAdapter } from './steam/adapter';
import { telegramAdapter } from './telegram/adapter';

const REGISTRY: Record<SupportedServiceId, ServiceAdapter> = {
  steam: steamAdapter,
  telegram: telegramAdapter,
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
  discord: discordAdapter,
  llm: llmAdapter,
};

export const getAdapter = (id: ServiceId | null): ServiceAdapter | null =>
  id ? ((REGISTRY as Partial<Record<ServiceId, ServiceAdapter>>)[id] ?? null) : null;

export const listAdapters = (): readonly ServiceAdapter[] => Object.values(REGISTRY);

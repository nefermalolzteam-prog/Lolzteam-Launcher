import type { ComponentType } from 'react';
import { DiscordDetails } from './DiscordDetails';
import { InstagramDetails } from './InstagramDetails';
import { LlmDetails } from './LlmDetails';
import { OriginDetails } from './OriginDetails';
import { RunDetails } from './RunDetails';
import { SteamCheckDetails } from './SteamCheckDetails';
import { SteamDetails } from './SteamDetails';
import { TelegramDetails } from './TelegramDetails';
import { TelegramProfileDetails } from './TelegramProfileDetails';
import { TikTokDetails } from './TikTokDetails';
import type { AccountDetailsProps } from './types';

/** The badge panels an account card renders under its title, in order. */
export const DETAILS_PANELS: readonly {
  id: string;
  Panel: ComponentType<AccountDetailsProps>;
}[] = [
  // The last run's verdict leads: it is the newest thing known about the account.
  { id: 'run', Panel: RunDetails },
  // Not a service panel: where the account came from.
  { id: 'origin', Panel: OriginDetails },
  { id: 'steam', Panel: SteamDetails },
  { id: 'steam-check', Panel: SteamCheckDetails },
  { id: 'telegram', Panel: TelegramDetails },
  // Our own check results, not the market's — the panel above renders nothing for a locally added account.
  { id: 'telegram-profile', Panel: TelegramProfileDetails },
  { id: 'discord', Panel: DiscordDetails },
  { id: 'instagram', Panel: InstagramDetails },
  { id: 'tiktok', Panel: TikTokDetails },
  // Category 6 is four products under one id, so this panel says less about «an LLM account» than about the plan on it.
  { id: 'llm', Panel: LlmDetails },
];

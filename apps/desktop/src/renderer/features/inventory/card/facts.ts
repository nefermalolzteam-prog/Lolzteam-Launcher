import type { AccountSummary, AccountTag, AccountValidity, TelegramProfile } from '@shared-types';
import {
  LLM_SERVICE_ICONS,
  LLM_SERVICE_LABELS,
  SERVICE_ICONS,
  STATUS_TAG_IDS,
  isLlmServiceSupported,
  isLocalAccount,
  isLocalServiceId,
} from '@shared-types';
import { useTranslation } from 'react-i18next';
import { type LabelColors, labelColors } from '~/lib/labelColor';
import { formatWarranty, toLoginService } from '~/lib/loginService';
import { logoFor } from '~/lib/serviceLogos';
import { useClockTick } from '~/lib/useClockTick';
import type { LoginService } from '~/stores/loginSession';
import { useProfileLabels } from '~/stores/profileLabels';
import { useSteamChecks } from '~/stores/steamChecks';
import { useTelegramAvatar, useTelegramProfiles } from '~/stores/telegramProfiles';
import { resolveAccountValidity } from '../accountValidity';
import { countryName, formatPrice, formatPurchasedAgo } from '../cardFormat';
import { isCheckable } from '../checkable';

/** The handle under the title for the services that ship one on the listing itself. */
const listingIdentity = (item: AccountSummary): string => {
  if (item.instagram?.username) return `@${item.instagram.username}`;
  const tt = item.tiktok;
  if (!tt) return '';
  // TikTok sends the display name and the handle separately, and on a fresh account they are the same string; say it once.
  const name = tt.screenName && tt.screenName !== tt.username ? tt.screenName : null;
  return [name, tt.username ? `@${tt.username}` : null].filter(Boolean).join(' · ');
};

export interface AccountFacts {
  /** The account itself, carried along so a shape needs only the facts object. */
  readonly item: AccountSummary;
  /** Hand-added: no price, no warranty, no market tags, no item page. */
  readonly isLocal: boolean;
  /** The login flow this category uses, or `null` when it has none. */
  readonly service: LoginService | null;
  readonly canLogin: boolean;
  readonly llmUnsupported: boolean;
  /** Steam, and the market has not already said there is no maFile. */
  readonly hasGuard: boolean;
  /** Whether «скопировать в базу» is worth offering: a bought account of a service the base can log in offline. */
  readonly copyable: boolean;
  /** Whether a mass run can reach this account — and so whether it may ask for one. */
  readonly checkable: boolean;
  readonly validity: AccountValidity;
  readonly isInvalid: boolean;
  readonly statusText: string;
  readonly tags: readonly AccountTag[];
  /** The tags worth drawing: the status pair is the verdict above, not a chip. */
  readonly chipTags: readonly AccountTag[];
  /** A chip's colours — the tag's own, or the profile label it came from. */
  readonly colorForTag: (tag: AccountTag) => LabelColors;
  readonly profile: TelegramProfile | undefined;
  readonly avatar: string | null;
  /** Name · @handle, from whoever can supply one. */
  readonly identity: string;
  /** Non-empty only when there is a name to draw initials from. */
  readonly initialsName: string;
  readonly initialsSeed: number;
  readonly thumbSrc: string | undefined;
  readonly categoryText: string;
  readonly country: string | null;
  /** The country in the interface language, or `''` when there is no country. */
  readonly countryText: string;
  readonly purchased: string | null;
  readonly warranty: string | null;
  /** Formatted, and empty for a local account — which has no price at all. */
  readonly price: string;
}

export const useAccountFacts = (item: AccountSummary): AccountFacts => {
  const { t, i18n } = useTranslation();
  // Every relative label below («Добавлен 5 мин.
  useClockTick();

  const isLocal = isLocalAccount(item);
  const tags = item.tags ?? item.steam?.tags ?? item.telegram?.tags ?? [];
  const chipTags = tags.filter((tag) => !STATUS_TAG_IDS.has(tag.id) && tag.title.trim() !== '');
  const labels = useProfileLabels((p) => p.labels);

  const service = toLoginService(item.category);
  const llmUnsupported = item.category === 'llm' && !isLlmServiceSupported(item.llmService);
  const hasGuard = item.category === 'steam' && item.hasMafile !== false;

  // Everything the last «База» run learned about this account.
  const profile = useTelegramProfiles((st) =>
    item.category === 'telegram' ? st.profiles.get(item.itemId) : undefined,
  );
  const avatar = useTelegramAvatar(item.itemId, profile?.hasAvatar === true);
  // The last Steam check, read from the same kind of sidecar.
  const steamCheck = useSteamChecks((st) =>
    item.category === 'steam' ? st.checks.get(item.itemId) : undefined,
  );

  /** «Непроверен / Невалид / Валид» — the one thing the header used to hide. */
  const validity = resolveAccountValidity(tags, profile, steamCheck);

  const categoryLogo = item.category ? logoFor(SERVICE_ICONS[item.category]) : undefined;
  const llmServiceLogo =
    item.category === 'llm' && item.llmService
      ? logoFor(LLM_SERVICE_ICONS[item.llmService])
      : undefined;

  const tg = item.telegram;
  // Discord is missing on purpose: the market ships no country for those items, only a locale.
  const country =
    tg?.country ?? item.steam?.country ?? item.instagram?.country ?? profile?.country ?? null;

  return {
    item,
    isLocal,
    service,
    canLogin: service !== null && !llmUnsupported,
    llmUnsupported,
    hasGuard,
    // `isLocalServiceId` rather than a list of our own: the base can hold exactly the services it declares.
    copyable: !isLocal && isLocalServiceId(item.category) && item.localCopyId === null,
    // Services a mass run can reach, and therefore the only cards that can ever have a verdict to show — the same rule.
    checkable: isCheckable(item),
    validity,
    isInvalid: validity === 'invalid',
    statusText: t(`inventory.card.validity.${validity}`),
    tags,
    chipTags,
    colorForTag: (tag) => labelColors(tag.bc ?? labels.find((l) => l.id === tag.id)?.bc),
    profile,
    avatar,
    // The handle under the title, whoever can supply one.
    identity: profile
      ? [profile.name, profile.username ? `@${profile.username}` : null].filter(Boolean).join(' · ')
      : listingIdentity(item),
    // An account that never set a photo has no file to download — Telegram draws initials on a coloured circle.
    initialsName: profile ? profile.name || profile.username || '' : '',
    initialsSeed: profile?.userId ?? item.itemId,
    thumbSrc: avatar ?? llmServiceLogo ?? item.imageUrl ?? categoryLogo,
    categoryText:
      item.category === 'llm' && item.llmService
        ? LLM_SERVICE_LABELS[item.llmService]
        : item.categoryTitle,
    country,
    countryText: country ? countryName(country, i18n.language) : '',
    purchased: item.purchasedAt ? formatPurchasedAgo(item.purchasedAt, t, i18n.language) : null,
    warranty: formatWarranty(item.warrantyEndsAt, t),
    price: isLocal ? '' : formatPrice(item.price, item.currency, i18n.language),
  };
};

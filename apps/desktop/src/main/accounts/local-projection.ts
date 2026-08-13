import type {
  AccountDetails,
  AccountSummary,
  AccountTag,
  LocalAccountRecord,
  LocalLabel,
} from '@shared-types';
import { serviceLabel } from '@shared-types';

const toUnixSeconds = (ms: number): number => Math.floor(ms / 1000);

/** What the account cannot tell about itself: where its folder is and what its label ids mean. */
export interface LocalProjectionContext {
  /** Label definitions by id; an id with no definition left is dropped. */
  labels?: ReadonlyMap<number, LocalLabel>;
  /** Folder per account id, relative to the service root — see `AccountSummary.folder`. */
  folders?: ReadonlyMap<number, string>;
}

/** The user's own labels, in the same shape the market's tags arrive in. */
const toTags = (
  record: LocalAccountRecord,
  labels?: ReadonlyMap<number, LocalLabel>,
): AccountTag[] => {
  if (!labels || labels.size === 0) return [];
  const out: AccountTag[] = [];
  for (const id of record.labels) {
    const label = labels.get(id);
    if (label) out.push({ id: label.id, title: label.title, bc: label.bc });
  }
  return out;
};

export const toSummary = (
  record: LocalAccountRecord,
  ctx?: LocalProjectionContext,
): AccountSummary => ({
  itemId: record.id,
  category: record.service,
  categoryRaw: record.service,
  categoryTitle: serviceLabel(record.service),
  title: record.label,
  description: '',
  // No purchase happened, so there is no price and no currency to render.
  price: 0,
  currency: '',
  // Remote images are blocked by the production CSP anyway; the card falls back to the service glyph.
  imageUrl: null,
  tags: toTags(record, ctx?.labels),
  // No market warranty exists, which also switches off the "warranty will be voided" confirmation on login.
  warrantyEndsAt: null,
  publishedAt: null,
  // Doubles as the sort key for the default `purchased/desc` ordering.
  purchasedAt: toUnixSeconds(record.createdAt),
  isPurchased: false,
  scope: 'local',
  // Left null on purpose: a synthetic `SteamInfo`/`TelegramInfo` would have to claim `vacBanned: false`.
  steam: null,
  telegram: null,
  discord: null,
  instagram: null,
  tiktok: null,
  llmService: null,
  llm: null,
  hasEmailLogin: false,
  // The one Steam detail the store does know first-hand.
  hasMafile: record.service === 'steam' ? record.sharedSecret !== null : null,
  // The note is the market's field, kept on the market — see `AccountSummary`.
  note: null,
  // `''` when nobody has sorted it anywhere yet — still a local account, which is why this is not null.
  folder: ctx?.folders?.get(record.id) ?? '',
  // Read straight off the record: this is the half of the pair that is stored.
  marketItemId: record.marketItemId,
  // A local account is never itself the source of a copy.
  localCopyId: null,
});

/** Secret layout mirrors what the adapters' own extractors look for: Steam. */
const buildSecrets = (record: LocalAccountRecord): Record<string, unknown> => {
  if (record.service === 'steam') {
    const secrets: Record<string, unknown> = {
      loginData: { login: record.login, password: record.password },
    };
    if (record.sharedSecret) secrets.steam_mafile = { shared_secret: record.sharedSecret };
    return secrets;
  }

  const secrets: Record<string, unknown> = {
    loginData: { raw: `${record.authKey}:${record.dcId}` },
    telegram_dc_id: record.dcId,
  };
  if (record.phone) secrets.telegram_phone = record.phone;
  if (record.userId !== null) secrets.telegram_id = record.userId;
  return secrets;
};

export const toDetails = (record: LocalAccountRecord): AccountDetails => ({
  ...toSummary(record),
  loginRaw: record.service === 'steam' ? record.login : (record.phone ?? null),
  passwordRaw: record.service === 'steam' ? record.password : null,
  secrets: buildSecrets(record),
  // The account is the user's own by definition.
  owned: true,
});

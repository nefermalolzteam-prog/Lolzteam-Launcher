import type {
  AccountDetails,
  AccountSummary,
  LocalAccountInput,
  LocalAccountRecord,
  LocalAccountResult,
  LocalServiceId,
} from '@shared-types';
import { isLocalServiceId } from '@shared-types';
import log from 'electron-log/main';
import { extractSteamCreds, extractSteamMafile } from '../adapters/steam/extract';
import { extractTelegramCreds } from '../adapters/telegram/extract';
import { fetchAccountDetails, fetchSteamMafileData } from '../services/market';
import { getGuardRecord } from '../services/steam-guard/session-store';
import { createLocalAccount, listLocalAccounts } from './local-store';
import { validateLocalAccount } from './local-validate';

/** Whether this copy may buy a maFile with the item's warranty. */
export type MafileChoice = 'fetch' | 'skip';

export interface CopyOptions {
  readonly mafile: MafileChoice;
}

const NO_FETCH: CopyOptions = { mafile: 'skip' };

/** Turns a fetched item into the same form the «добавить вручную» dialog submits. */
interface CopyBuild {
  readonly input: LocalAccountInput;
  readonly note?: string;
}

type CopyBuilder = (
  details: AccountDetails,
  itemId: number,
  options: CopyOptions,
) => Promise<CopyBuild | null>;

/** The three keys a Steam Guard maFile is worth, from whichever source had them. */
interface GuardKeys {
  readonly sharedSecret: string | null;
  readonly identitySecret: string | null;
  readonly deviceId: string | null;
}

/** Back into the shape the form's guard field reads: a maFile. */
const guardField = (keys: GuardKeys | null): string =>
  keys?.sharedSecret
    ? JSON.stringify({
        shared_secret: keys.sharedSecret,
        ...(keys.identitySecret ? { identity_secret: keys.identitySecret } : {}),
        ...(keys.deviceId ? { device_id: keys.deviceId } : {}),
      })
    : '';

/** The linked authenticator's keys, or null when it has nothing to give. */
const storedKeys = async (itemId: number): Promise<GuardKeys | null> => {
  const record = await getGuardRecord(itemId);
  return record?.sharedSecret ? record : null;
};

const buildSteam: CopyBuilder = async (details, itemId, { mafile }) => {
  const creds = extractSteamCreds(details);
  if (!creds) return null;

  // Free first, and in that order: what the item already carries.
  const item = extractSteamMafile(details);
  const free: GuardKeys | null = item?.sharedSecret ? item : await storedKeys(itemId);
  // …and only then the one that costs the guarantee.
  const bought = free === null && mafile === 'fetch' ? await fetchSteamMafileData(itemId) : null;

  return {
    input: {
      service: 'steam',
      label: details.title,
      login: creds.login,
      password: creds.password,
      guard: guardField(free ?? bought),
    },
    // Worth an entry of its own: this is the moment the item stopped having a guarantee.
    note: bought ? 'mafile fetched, warranty spent' : undefined,
  };
};

const buildTelegram: CopyBuilder = async (details) => {
  const creds = extractTelegramCreds(details);
  // A phone alone is not enough: the base logs in offline from the key.
  if (!creds?.authKey) return null;
  return {
    input: {
      service: 'telegram',
      label: details.title,
      authKey: creds.authKey.authKeyHex,
      dcId: String(creds.authKey.dcId),
      phone: creds.phone,
      userId: creds.userId === null ? '' : String(creds.userId),
    },
  };
};

const BUILDERS: Record<LocalServiceId, CopyBuilder> = {
  steam: buildSteam,
  telegram: buildTelegram,
};

export type MarketCopyResult =
  | {
      ok: true;
      id: number;
      /** One line for the journal about how the copy was made, or `null`. */
      detail: string | null;
    }
  | {
      ok: false;
      message:
        | 'invalid_item'
        | 'already_copied'
        | 'not_found'
        | 'unreachable'
        | 'not_owned'
        | 'unsupported'
        | 'no_credentials'
        | string;
    };

/** market item id → the local account copied from it. */
export const indexCopies = (
  records: readonly Pick<LocalAccountRecord, 'id' | 'marketItemId'>[],
): Map<number, number> => {
  const out = new Map<number, number>();
  for (const record of records) {
    // First writer wins.
    if (record.marketItemId !== null && !out.has(record.marketItemId)) {
      out.set(record.marketItemId, record.id);
    }
  }
  return out;
};

/** Stamps `localCopyId` onto whichever items have a copy, leaving the rest of the list identical — same objects. */
export const stampCopies = (
  items: readonly AccountSummary[],
  index: ReadonlyMap<number, number>,
): AccountSummary[] =>
  items.map((item) => {
    const copyId = index.get(item.itemId) ?? null;
    return copyId === item.localCopyId ? item : { ...item, localCopyId: copyId };
  });

/** The index as the base stands right now. */
export const loadCopyIndex = async (): Promise<Map<number, number>> =>
  indexCopies(await listLocalAccounts());

/** Copies one bought account into the local base. */
export const copyToBase = async (
  itemId: number,
  options: CopyOptions = NO_FETCH,
): Promise<MarketCopyResult> => {
  if (!Number.isInteger(itemId) || itemId <= 0) return { ok: false, message: 'invalid_item' };

  const existing = (await loadCopyIndex()).get(itemId);
  if (existing !== undefined) return { ok: false, message: 'already_copied' };

  const fetched = await fetchAccountDetails(itemId);
  if (!fetched.ok) return { ok: false, message: fetched.reason };
  const { details } = fetched;
  if (!details.owned) return { ok: false, message: 'not_owned' };

  const service = details.category;
  if (!isLocalServiceId(service)) return { ok: false, message: 'unsupported' };

  const built = await BUILDERS[service](details, itemId, options);
  if (built === null) return { ok: false, message: 'no_credentials' };

  const validated = validateLocalAccount(built.input);
  if (!validated.ok) {
    log.warn(`[market-copy] item #${itemId} did not validate: ${validated.message}`);
    return { ok: false, message: validated.message };
  }

  const created: LocalAccountResult = await createLocalAccount(validated.value, itemId);
  if (!created.ok) return created;
  log.info(`[market-copy] item #${itemId} copied into the base as ${created.id}`);
  return { ok: true, id: created.id, detail: built.note ?? null };
};

import type { LocalSteamRecord, LocalTelegramRecord } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { extractSteamCreds } from '../../adapters/steam/extract';
import { extractTelegramCreds } from '../../adapters/telegram/extract';
import { toDetails, toSummary } from '../local-projection';

const SECRET = 'MTIzNDU2Nzg5MGFiY2RlZmdoaWo=';
const HEX = 'a1'.repeat(256);

const steam: LocalSteamRecord = {
  id: -1,
  service: 'steam',
  label: 'Main Steam',
  login: 'user01',
  password: 'p@ss w0rd',
  sharedSecret: SECRET,
  // The projection deliberately says nothing about these two: the login adapters read only the shared secret.
  identitySecret: 'aWRlbnRpdHktc2VjcmV0LTEyMzQ1Ng==',
  deviceId: 'android:11111111-2222-3333-4444-555555555555',
  labels: [],
  marketItemId: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const telegram: LocalTelegramRecord = {
  id: -2,
  service: 'telegram',
  label: 'Work TG',
  authKey: HEX,
  dcId: 4,
  phone: '+79001234567',
  userId: 424242,
  labels: [],
  marketItemId: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

describe('toSummary', () => {
  it('marks the item local, keeps the negative id and hides market-only fields', () => {
    const s = toSummary(steam);
    expect(s.itemId).toBe(-1);
    expect(s.scope).toBe('local');
    expect(s.category).toBe('steam');
    expect(s.title).toBe('Main Steam');
    expect(s.price).toBe(0);
    expect(s.currency).toBe('');
    expect(s.warrantyEndsAt).toBeNull();
    expect(s.imageUrl).toBeNull();
    expect(s.tags).toEqual([]);
    expect(s.hasEmailLogin).toBe(false);
    expect(s.steam).toBeNull();
    expect(s.telegram).toBeNull();
  });

  it('exposes createdAt as unix seconds so the default sort has a key', () => {
    expect(toSummary(steam).purchasedAt).toBe(1_700_000_000);
  });

  // The card's only source for the maFile badge on a local Steam account: it has no `SteamInfo` to read `steam_mfa` from.
  it('reports the maFile as present exactly when a shared secret is stored', () => {
    expect(toSummary(steam).hasMafile).toBe(true);
    expect(toSummary({ ...steam, sharedSecret: null }).hasMafile).toBe(false);
  });

  it('leaves the maFile question unanswered for a non-Steam account', () => {
    expect(toSummary(telegram).hasMafile).toBeNull();
  });
});

/** What the account cannot tell about itself. */
describe('toSummary with a projection context', () => {
  const labels = new Map([
    [-1, { id: -1, title: 'Продажа', bc: '#e5b84b' }],
    [-2, { id: -2, title: 'Работа', bc: '#4b9ae5' }],
  ]);

  it('turns label ids into the same tags the market sends', () => {
    const tags = toSummary({ ...steam, labels: [-2, -1] }, { labels }).tags;
    // Order follows the account, not the palette — the user's own arrangement.
    expect(tags).toEqual([
      { id: -2, title: 'Работа', bc: '#4b9ae5' },
      { id: -1, title: 'Продажа', bc: '#e5b84b' },
    ]);
  });

  // Deleting a label leaves its id on every account wearing it; the definition is gone, so the chip is simply not drawn.
  it('drops an id whose definition was deleted', () => {
    expect(toSummary({ ...steam, labels: [-1, -7] }, { labels }).tags).toEqual([
      { id: -1, title: 'Продажа', bc: '#e5b84b' },
    ]);
  });

  it('shows no tags at all when nobody looked the palette up', () => {
    expect(toSummary({ ...steam, labels: [-1] }).tags).toEqual([]);
  });

  // `''` and `null` are different answers and the folder filter relies on it: one is «local, not sorted anywhere».
  it('takes the folder from the walk, and calls the root an empty string', () => {
    const folders = new Map([[-1, 'Продажа/Старые']]);
    expect(toSummary(steam, { folders }).folder).toBe('Продажа/Старые');
    expect(toSummary(telegram, { folders }).folder).toBe('');
    expect(toSummary(steam).folder).toBe('');
  });
});

// The contract that lets the adapters stay untouched: whatever key layout `adapters/*/extract.ts` reads.
describe('toDetails → adapter extractors', () => {
  it('feeds extractSteamCreds a complete credential set', () => {
    expect(extractSteamCreds(toDetails(steam))).toEqual({
      login: 'user01',
      password: 'p@ss w0rd',
      sharedSecret: SECRET,
    });
  });

  it('reports no shared secret when the account has no guard configured', () => {
    const creds = extractSteamCreds(toDetails({ ...steam, sharedSecret: null }));
    expect(creds).toEqual({ login: 'user01', password: 'p@ss w0rd', sharedSecret: null });
  });

  it('feeds extractTelegramCreds the auth key, dc, phone and user id', () => {
    const creds = extractTelegramCreds(toDetails(telegram));
    expect(creds).not.toBeNull();
    expect(creds?.authKey).toEqual({ authKeyHex: HEX, dcId: 4 });
    expect(creds?.phone).toBe('+79001234567');
    expect(creds?.userId).toBe(424242);
  });

  it('still yields a usable auth key when phone and user id are absent', () => {
    const creds = extractTelegramCreds(toDetails({ ...telegram, phone: null, userId: null }));
    expect(creds?.authKey).toEqual({ authKeyHex: HEX, dcId: 4 });
    expect(creds?.userId).toBeNull();
  });

  it('marks the account as owned so the login path does not refuse it', () => {
    expect(toDetails(steam).owned).toBe(true);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Both of these used to be dependencies of this module. */
const fetchAccountDetails = vi.fn();
vi.mock('../../market', () => ({ fetchAccountDetails }));

const extractTelegramCreds = vi.fn();
vi.mock('../../../adapters/telegram/extract', () => ({ extractTelegramCreds }));

const getLocalAccount = vi.fn();
vi.mock('../../../accounts/local-store', () => ({ getLocalAccount }));

vi.mock('../../../settings/settings-store', () => ({
  getSettings: vi.fn(async () => ({ proxyEnabled: false, proxies: [] })),
}));

vi.mock('../../../adapters/telegram/session', () => ({
  buildOfflineSession: vi.fn(() => ({ authKey: new Uint8Array(), primaryDcs: {} })),
}));

const { resolveTelegramAccount } = await import('../resolve');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveTelegramAccount, bought accounts', () => {
  it('refuses a market id and says what is missing', async () => {
    expect(await resolveTelegramAccount(12)).toEqual({ ok: false, reason: 'not_in_base' });
  });

  // The point of the refusal is that nothing happens — no request.
  it('asks the market nothing on the way to that answer', async () => {
    await resolveTelegramAccount(12);
    expect(fetchAccountDetails).not.toHaveBeenCalled();
    expect(extractTelegramCreds).not.toHaveBeenCalled();
    expect(getLocalAccount).not.toHaveBeenCalled();
  });

  // Zero is not a local id, and the base never issues one.
  it('treats a zero id as a market id', async () => {
    expect(await resolveTelegramAccount(0)).toEqual({ ok: false, reason: 'not_in_base' });
  });
});

describe('resolveTelegramAccount, local side', () => {
  // Negative ids never touch the market, so nothing here can be a network failure.
  it('never asks the market about a local account', async () => {
    getLocalAccount.mockResolvedValue(null);
    expect(await resolveTelegramAccount(-3)).toEqual({ ok: false, reason: 'no_account' });
    expect(fetchAccountDetails).not.toHaveBeenCalled();
  });

  it('refuses a local account from another service', async () => {
    getLocalAccount.mockResolvedValue({ id: -3, service: 'steam' });
    expect(await resolveTelegramAccount(-3)).toEqual({ ok: false, reason: 'not_telegram' });
  });

  it('hands back a session when the record has a key', async () => {
    getLocalAccount.mockResolvedValue({
      id: -3,
      service: 'telegram',
      authKey: 'ab'.repeat(256),
      dcId: 2,
      userId: 5,
      phone: '79991234567',
    });

    const result = await resolveTelegramAccount(-3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.account).toMatchObject({ accountId: -3, phone: '79991234567' });
  });
});

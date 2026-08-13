import type { AccountDetails } from '@shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fetchAccountDetails = vi.fn();
const fetchSteamMafileData = vi.fn();
vi.mock('../../services/market', () => ({ fetchAccountDetails, fetchSteamMafileData }));

const getGuardRecord = vi.fn();
vi.mock('../../services/steam-guard/session-store', () => ({ getGuardRecord }));

const createLocalAccount = vi.fn();
const listLocalAccounts = vi.fn();
vi.mock('../local-store', () => ({ createLocalAccount, listLocalAccounts }));

const { copyToBase } = await import('../market-copy');

/** 20 байт base64 — то, что `local-validate` считает правдоподобным секретом. */
const SECRET = 'MTIzNDU2Nzg5MGFiY2RlZmdoaWo=';
const OTHER_SECRET = 'YWJjZGVmZ2hpajEyMzQ1Njc4OTA=';

const steamItem = (secrets: Record<string, unknown> = {}): AccountDetails =>
  ({
    itemId: 42,
    category: 'steam',
    title: 'Steam',
    owned: true,
    loginRaw: 'user01',
    passwordRaw: 'p@ssw0rd',
    secrets,
  }) as unknown as AccountDetails;

beforeEach(() => {
  vi.clearAllMocks();
  listLocalAccounts.mockResolvedValue([]);
  createLocalAccount.mockResolvedValue({ ok: true, id: -1 });
  getGuardRecord.mockResolvedValue(null);
  fetchAccountDetails.mockResolvedValue({ ok: true, details: steamItem() });
  fetchSteamMafileData.mockResolvedValue({ sharedSecret: SECRET });
});

const savedSecret = (): string | null =>
  (createLocalAccount.mock.calls[0]?.[0] as { sharedSecret: string | null } | undefined)
    ?.sharedSecret ?? null;

describe('copyToBase, вопрос о maFile', () => {
  // Умолчание — единственная защита от того, чтобы гарантию потратил вызов, который про неё вообще не думал.
  it('без опций гарантию не тратит', async () => {
    const res = await copyToBase(42);
    expect(res).toEqual({ ok: true, id: -1, detail: null });
    expect(fetchSteamMafileData).not.toHaveBeenCalled();
    expect(savedSecret()).toBeNull();
  });

  it('`skip` — то же самое, сказанное вслух', async () => {
    await copyToBase(42, { mafile: 'skip' });
    expect(fetchSteamMafileData).not.toHaveBeenCalled();
    expect(savedSecret()).toBeNull();
  });

  it('`fetch` — забирает секрет и пишет об этом в журнал', async () => {
    const res = await copyToBase(42, { mafile: 'fetch' });
    expect(fetchSteamMafileData).toHaveBeenCalledWith(42);
    expect(savedSecret()).toBe(SECRET);
    expect(res).toMatchObject({ ok: true, detail: expect.stringContaining('mafile') });
  });
});

describe('copyToBase, бесплатные источники секрета', () => {
  // Лот несёт maFile только если его уже когда-то запрашивали; второй раз платить не за что.
  it('секрет из самого лота отменяет запрос', async () => {
    fetchAccountDetails.mockResolvedValue({
      ok: true,
      details: steamItem({ steam_mafile: { shared_secret: SECRET } }),
    });

    const res = await copyToBase(42, { mafile: 'fetch' });
    expect(fetchSteamMafileData).not.toHaveBeenCalled();
    expect(savedSecret()).toBe(SECRET);
    // Гарантия цела — значит и записи о её трате быть не должно.
    expect(res).toEqual({ ok: true, id: -1, detail: null });
  });

  it('секрет из guard-хранилища тоже', async () => {
    getGuardRecord.mockResolvedValue({ sharedSecret: OTHER_SECRET });

    await copyToBase(42, { mafile: 'fetch' });
    expect(getGuardRecord).toHaveBeenCalledWith(42);
    expect(fetchSteamMafileData).not.toHaveBeenCalled();
    expect(savedSecret()).toBe(OTHER_SECRET);
  });

  // Запрос вернул пустоту — это не ошибка копирования: аккаунт без Guard копируется ровно так же, просто без секрета.
  it('пустой ответ маркета не ломает копию', async () => {
    fetchSteamMafileData.mockResolvedValue(null);

    const res = await copyToBase(42, { mafile: 'fetch' });
    expect(res).toEqual({ ok: true, id: -1, detail: null });
    expect(savedSecret()).toBeNull();
  });
});

describe('copyToBase, отказы', () => {
  it('чужой лот не копируется и maFile у него не просят', async () => {
    fetchAccountDetails.mockResolvedValue({ ok: true, details: { ...steamItem(), owned: false } });

    expect(await copyToBase(42, { mafile: 'fetch' })).toEqual({ ok: false, message: 'not_owned' });
    expect(fetchSteamMafileData).not.toHaveBeenCalled();
    expect(createLocalAccount).not.toHaveBeenCalled();
  });

  it('уже скопированный лот второй раз ничего не стоит', async () => {
    listLocalAccounts.mockResolvedValue([{ id: -7, marketItemId: 42 }]);

    expect(await copyToBase(42, { mafile: 'fetch' })).toEqual({
      ok: false,
      message: 'already_copied',
    });
    expect(fetchAccountDetails).not.toHaveBeenCalled();
    expect(fetchSteamMafileData).not.toHaveBeenCalled();
  });
});

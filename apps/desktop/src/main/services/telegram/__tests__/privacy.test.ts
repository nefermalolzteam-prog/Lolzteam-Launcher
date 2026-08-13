import { tl } from '@mtcute/core';
import type { TelegramClient } from '@mtcute/core/client.js';
import type { TelegramPrivacyRequest } from '@shared-types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { applyTelegramPrivacy } = await import('../privacy');

const ME = {
  id: 777,
  phoneNumber: '79991234567',
  username: 'seller',
  displayName: 'Иван',
  isPremium: false,
  photo: null,
};

const appConfig = (entries: Record<string, unknown> = {}) => ({
  _: 'help.appConfig',
  hash: 0,
  config: {
    _: 'jsonObject',
    value: Object.entries(entries).map(([key, value]) => ({ _: 'jsonObjectValue', key, value })),
  },
});

type Call = { _: string; key?: { _: string }; rules?: readonly { _: string }[] };

/** One `call` mock for both the freeze probe and the writes: the app config is answered as itself. */
const clientWith = (onSet: (call: Call) => unknown = () => undefined) => {
  const setCalls: Call[] = [];
  const call = vi.fn(async (req: Call) => {
    if (req._ !== 'account.setPrivacy') return appConfig();
    setCalls.push(req);
    return onSet(req);
  });
  const client = { getMe: vi.fn(async () => ME), call };
  return { client: client as unknown as TelegramClient, call, setCalls };
};

const apply = (client: TelegramClient, rules: TelegramPrivacyRequest['rules']) =>
  applyTelegramPrivacy(client, rules, () => undefined);

describe('applyTelegramPrivacy', () => {
  it('translates our names and answers into Telegram’s', async () => {
    const { client, setCalls } = clientWith();
    const { result } = await apply(client, { phone: 'nobody', bio: 'contacts' });
    expect(result.applied).toEqual(expect.arrayContaining(['phone', 'bio']));
    expect(result.failed).toEqual([]);
    expect(setCalls).toEqual([
      {
        _: 'account.setPrivacy',
        key: { _: 'inputPrivacyKeyPhoneNumber' },
        rules: [{ _: 'inputPrivacyValueDisallowAll' }],
      },
      {
        _: 'account.setPrivacy',
        key: { _: 'inputPrivacyKeyAbout' },
        rules: [{ _: 'inputPrivacyValueAllowContacts' }],
      },
    ]);
  });

  // The Premium-only key is written last on purpose.
  it('writes the Premium-only switch after the others', async () => {
    const { client, setCalls } = clientWith();
    await apply(client, { voices: 'nobody', lastSeen: 'nobody', calls: 'contacts' });
    expect(setCalls.at(-1)?.key).toEqual({ _: 'inputPrivacyKeyVoiceMessages' });
  });

  /** «Нужен Premium» is not «не вышло». */
  it('files a Premium refusal apart from a failure', async () => {
    const { client } = clientWith((req) => {
      if (req.key?._ === 'inputPrivacyKeyVoiceMessages') {
        throw new tl.RpcError(403, 'PREMIUM_ACCOUNT_REQUIRED');
      }
      return undefined;
    });
    const { result } = await apply(client, { voices: 'nobody', phone: 'nobody' });
    expect(result.needsPremium).toEqual(['voices']);
    expect(result.applied).toEqual(['phone']);
    expect(result.failed).toEqual([]);
  });

  it('counts one refused switch and still writes the rest', async () => {
    const { client } = clientWith((req) => {
      if (req.key?._ === 'inputPrivacyKeyBirthday')
        throw new tl.RpcError(400, 'PRIVACY_KEY_INVALID');
      return undefined;
    });
    const { result } = await apply(client, { birthday: 'contacts', phone: 'nobody' });
    expect(result.failed).toEqual(['birthday']);
    expect(result.applied).toEqual(['phone']);
  });

  // The runner owns the waiting.
  it('lets a flood wait out to the runner', async () => {
    const { client } = clientWith(() => {
      throw tl.RpcError.fromTl({ _: 'rpc_error', errorCode: 420, errorMessage: 'FLOOD_WAIT_30' });
    });
    await expect(apply(client, { phone: 'nobody', bio: 'nobody' })).rejects.toThrow();
  });

  it('stops on a freeze and keeps what was already written', async () => {
    const { client } = clientWith((req) => {
      if (req.key?._ === 'inputPrivacyKeyAbout')
        throw new tl.RpcError(400, 'FROZEN_METHOD_INVALID');
      return undefined;
    });
    const { result, info } = await apply(client, { phone: 'nobody', bio: 'nobody' });
    expect(info.status).toBe('frozen');
    expect(result.applied).toEqual(['phone']);
    expect(result.failed).toEqual([]);
  });

  it('reports a freeze the app config admits without writing anything', async () => {
    const { client, setCalls } = clientWith();
    (client as unknown as { call: ReturnType<typeof vi.fn> }).call = vi.fn(async (req: Call) => {
      if (req._ !== 'account.setPrivacy') {
        return appConfig({ freeze_since_date: { _: 'jsonNumber', value: 1 } });
      }
      setCalls.push(req);
      return undefined;
    });
    const { result, info } = await apply(client, { phone: 'nobody' });
    expect(info.status).toBe('frozen');
    expect(result).toEqual({ applied: [], failed: [], needsPremium: [] });
    expect(setCalls).toEqual([]);
  });

  it('reports a dead key instead of nine failed switches', async () => {
    const { client } = clientWith();
    (client as unknown as { getMe: ReturnType<typeof vi.fn> }).getMe = vi.fn(async () =>
      Promise.reject(new tl.RpcError(401, 'AUTH_KEY_UNREGISTERED')),
    );
    const { result, info } = await apply(client, { phone: 'nobody' });
    expect(info.status).toBe('dead');
    expect(result).toEqual({ applied: [], failed: [], needsPremium: [] });
  });
});

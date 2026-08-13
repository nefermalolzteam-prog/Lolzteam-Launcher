import type { LocalSteamRecord, LocalTelegramRecord } from '@shared-types';
import { describe, expect, it } from 'vitest';
import {
  parseAuthKeyInput,
  parseGuardInput,
  parseSteamGuard,
  validateLocalAccount,
} from '../local-validate';

const SECRET = 'MTIzNDU2Nzg5MGFiY2RlZmdoaWo=';
const IDENTITY = 'aWRlbnRpdHktc2VjcmV0LTEyMzQ1Ng==';
const DEVICE = 'android:11111111-2222-3333-4444-555555555555';
const HEX = 'a1'.repeat(256);

const steamRecord = (over: Partial<LocalSteamRecord> = {}): LocalSteamRecord => ({
  id: -1,
  service: 'steam',
  label: 'old',
  login: 'user',
  password: 'pass',
  sharedSecret: SECRET,
  identitySecret: IDENTITY,
  deviceId: DEVICE,
  labels: [],
  marketItemId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const telegramRecord = (over: Partial<LocalTelegramRecord> = {}): LocalTelegramRecord => ({
  id: -2,
  service: 'telegram',
  label: 'old',
  authKey: HEX,
  dcId: 2,
  phone: '+79001234567',
  userId: 777,
  labels: [],
  marketItemId: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('parseSteamGuard', () => {
  it('accepts a full maFile pasted as JSON text', () => {
    const maFile = JSON.stringify({
      shared_secret: SECRET,
      identity_secret: 'x',
      account_name: 'y',
    });
    expect(parseSteamGuard(maFile)).toBe(SECRET);
  });

  it('accepts the nested { maFile: … } envelope the market endpoint returns', () => {
    expect(parseSteamGuard(JSON.stringify({ maFile: { shared_secret: SECRET } }))).toBe(SECRET);
  });

  it('accepts the camelCase key', () => {
    expect(parseSteamGuard(JSON.stringify({ sharedSecret: SECRET }))).toBe(SECRET);
  });

  it('accepts a bare shared_secret, which is not valid JSON', () => {
    expect(parseSteamGuard(SECRET)).toBe(SECRET);
    expect(parseSteamGuard(`  ${SECRET}  `)).toBe(SECRET);
  });

  it('rejects prose, truncated secrets and JSON without a secret', () => {
    expect(parseSteamGuard('no guard here')).toBeNull();
    expect(parseSteamGuard('short')).toBeNull();
    expect(parseSteamGuard(JSON.stringify({ account_name: 'y' }))).toBeNull();
    expect(parseSteamGuard(JSON.stringify({ shared_secret: 'nope' }))).toBeNull();
    expect(parseSteamGuard('')).toBeNull();
  });
});

describe('parseGuardInput', () => {
  it('keeps the two keys confirmations run on', () => {
    const maFile = JSON.stringify({
      shared_secret: SECRET,
      identity_secret: IDENTITY,
      device_id: DEVICE,
    });
    expect(parseGuardInput(maFile)).toEqual({
      sharedSecret: SECRET,
      identitySecret: IDENTITY,
      deviceId: DEVICE,
    });
  });

  it('reads them out of the { maFile: … } envelope too', () => {
    const wrapped = JSON.stringify({
      maFile: { sharedSecret: SECRET, identitySecret: IDENTITY, deviceId: DEVICE },
    });
    expect(parseGuardInput(wrapped)).toMatchObject({
      identitySecret: IDENTITY,
      deviceId: DEVICE,
    });
  });

  it('a bare secret is a complete answer for codes and nothing more', () => {
    expect(parseGuardInput(SECRET)).toEqual({
      sharedSecret: SECRET,
      identitySecret: null,
      deviceId: null,
    });
  });

  it('drops an implausible identity secret instead of failing the whole paste', () => {
    const maFile = JSON.stringify({ shared_secret: SECRET, identity_secret: 'nope' });
    expect(parseGuardInput(maFile)).toEqual({
      sharedSecret: SECRET,
      identitySecret: null,
      deviceId: null,
    });
  });
});

describe('parseAuthKeyInput', () => {
  it('parses the "<hex>:<dc>" form', () => {
    expect(parseAuthKeyInput(`${HEX}:3`)).toEqual({ authKeyHex: HEX, dcId: 3 });
  });

  it('parses the bare hex form without a dc', () => {
    expect(parseAuthKeyInput(HEX)).toEqual({ authKeyHex: HEX, dcId: null });
  });

  it('lowercases hex and ignores whitespace from a wrapped paste', () => {
    const upper = 'A1'.repeat(256);
    expect(parseAuthKeyInput(`${upper.slice(0, 100)}\n ${upper.slice(100)} :4`)).toEqual({
      authKeyHex: HEX,
      dcId: 4,
    });
  });

  it('rejects a truncated or non-hex key', () => {
    expect(parseAuthKeyInput('a1'.repeat(255))).toBeNull();
    expect(parseAuthKeyInput(`${'zz'.repeat(256)}:1`)).toBeNull();
    expect(parseAuthKeyInput('')).toBeNull();
  });

  it('rejects dc ids outside the production range', () => {
    expect(parseAuthKeyInput(`${HEX}:0`)).toBeNull();
    expect(parseAuthKeyInput(`${HEX}:6`)).toBeNull();
    expect(parseAuthKeyInput(`${HEX}:x`)).toBeNull();
  });
});

describe('validateLocalAccount — steam', () => {
  it('accepts login + password with no guard', () => {
    const res = validateLocalAccount({
      service: 'steam',
      label: '',
      login: 'u',
      password: 'p',
      guard: '',
    });
    expect(res).toEqual({
      ok: true,
      value: {
        service: 'steam',
        label: 'u',
        login: 'u',
        password: 'p',
        sharedSecret: null,
        identitySecret: null,
        deviceId: null,
      },
    });
  });

  it('rejects a missing login or password on create', () => {
    expect(validateLocalAccount({ service: 'steam', login: '', password: 'p', guard: '' })).toEqual(
      {
        ok: false,
        message: 'invalid_login',
      },
    );
    expect(validateLocalAccount({ service: 'steam', login: 'u', password: '', guard: '' })).toEqual(
      {
        ok: false,
        message: 'invalid_password',
      },
    );
  });

  it('keeps the stored password and guard when the fields are left blank on edit', () => {
    const res = validateLocalAccount(
      { service: 'steam', label: 'new', login: 'u2', password: '', guard: '' },
      steamRecord(),
    );
    expect(res).toEqual({
      ok: true,
      value: {
        service: 'steam',
        label: 'new',
        login: 'u2',
        password: 'pass',
        sharedSecret: SECRET,
        identitySecret: IDENTITY,
        deviceId: DEVICE,
      },
    });
  });

  it('clears the guard only when asked explicitly', () => {
    const res = validateLocalAccount(
      { service: 'steam', login: 'u', password: '', guard: '', clearGuard: true },
      steamRecord(),
    );
    expect(res.ok && res.value).toMatchObject({
      sharedSecret: null,
      identitySecret: null,
      deviceId: null,
    });
  });

  it('a re-pasted bare secret replaces the whole maFile, not just one key of it', () => {
    const other = 'b3RoZXItc2VjcmV0LTAxMjM0NTY3OA==';
    const res = validateLocalAccount(
      { service: 'steam', login: 'u', password: '', guard: other },
      steamRecord(),
    );
    expect(res.ok && res.value).toMatchObject({
      sharedSecret: other,
      identitySecret: null,
      deviceId: null,
    });
  });

  it('rejects an unparsable guard', () => {
    expect(
      validateLocalAccount({ service: 'steam', login: 'u', password: 'p', guard: 'garbage' }),
    ).toEqual({ ok: false, message: 'invalid_guard' });
  });
});

describe('validateLocalAccount — telegram', () => {
  it('accepts the combined key form and derives the dc from it', () => {
    const res = validateLocalAccount({
      service: 'telegram',
      label: '',
      authKey: `${HEX}:2`,
      dcId: '',
      phone: '+7 900 123-45-67',
      userId: '777',
    });
    expect(res).toEqual({
      ok: true,
      value: {
        service: 'telegram',
        label: '+79001234567',
        authKey: HEX,
        dcId: 2,
        phone: '+79001234567',
        userId: 777,
      },
    });
  });

  it('accepts separate key and dc fields, with phone and user id optional', () => {
    const res = validateLocalAccount({
      service: 'telegram',
      label: 'main',
      authKey: HEX,
      dcId: '4',
      phone: '',
      userId: '',
    });
    expect(res).toEqual({
      ok: true,
      value: {
        service: 'telegram',
        label: 'main',
        authKey: HEX,
        dcId: 4,
        phone: null,
        userId: null,
      },
    });
  });

  it('refuses to guess when the pasted dc and the typed dc disagree', () => {
    expect(
      validateLocalAccount({
        service: 'telegram',
        authKey: `${HEX}:2`,
        dcId: '3',
        phone: '',
        userId: '',
      }),
    ).toEqual({ ok: false, message: 'dc_conflict' });
  });

  it('requires a dc when neither the key nor the form carries one', () => {
    expect(
      validateLocalAccount({ service: 'telegram', authKey: HEX, dcId: '', phone: '', userId: '' }),
    ).toEqual({ ok: false, message: 'invalid_dc' });
  });

  it('keeps the stored auth key and dc when the fields are left blank on edit', () => {
    const res = validateLocalAccount(
      { service: 'telegram', label: 'renamed', authKey: '', dcId: '', phone: '', userId: '' },
      telegramRecord(),
    );
    expect(res).toEqual({
      ok: true,
      value: {
        service: 'telegram',
        label: 'renamed',
        authKey: HEX,
        dcId: 2,
        // Non-secret fields round-trip through the form, so blank means "clear".
        phone: null,
        userId: null,
      },
    });
  });

  it('rejects an implausible phone or a non-positive user id', () => {
    expect(
      validateLocalAccount({
        service: 'telegram',
        authKey: `${HEX}:1`,
        dcId: '',
        phone: '123',
        userId: '',
      }),
    ).toEqual({ ok: false, message: 'invalid_phone' });
    expect(
      validateLocalAccount({
        service: 'telegram',
        authKey: `${HEX}:1`,
        dcId: '',
        phone: '',
        userId: '0',
      }),
    ).toEqual({ ok: false, message: 'invalid_user_id' });
  });

  it('requires an auth key on create', () => {
    expect(
      validateLocalAccount({ service: 'telegram', authKey: '', dcId: '1', phone: '', userId: '' }),
    ).toEqual({ ok: false, message: 'invalid_auth_key' });
  });
});

describe('validateLocalAccount — envelope', () => {
  it('rejects unsupported and malformed services', () => {
    expect(validateLocalAccount({ service: 'discord', login: 'u', password: 'p' })).toEqual({
      ok: false,
      message: 'invalid_service',
    });
    expect(validateLocalAccount(null)).toEqual({ ok: false, message: 'invalid_input' });
    expect(validateLocalAccount('steam')).toEqual({ ok: false, message: 'invalid_input' });
  });

  it('refuses to switch an existing account to another service', () => {
    expect(
      validateLocalAccount(
        { service: 'steam', login: 'u', password: 'p', guard: '' },
        telegramRecord(),
      ),
    ).toEqual({ ok: false, message: 'service_mismatch' });
  });
});

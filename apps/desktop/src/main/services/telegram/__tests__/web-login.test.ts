import { describe, expect, it } from 'vitest';
import { STALE_KEYS, buildWebAStorage, buildWebInjectionScript } from '../web-login';

const AUTH_KEY = 'ab'.repeat(256);

const parse = (raw: string | undefined) => JSON.parse(raw ?? 'null');

describe('buildWebAStorage', () => {
  it('writes the slot record Web A reads its main dc from', () => {
    const s = buildWebAStorage({ authKeyHex: AUTH_KEY, dcId: 4, userId: 12345 });

    // `loadSlotSession` JSON.parses this key and takes `dcId` as `mainDcId`.
    expect(parse(s.account1)).toEqual({
      dcId: 4,
      dc4_auth_key: AUTH_KEY,
      userId: '12345',
    });
  });

  it('writes the legacy mirror too, in the shape the fallback loader reads', () => {
    const s = buildWebAStorage({ authKeyHex: AUTH_KEY, dcId: 4, userId: 12345 });

    expect(parse(s.user_auth)).toEqual({ dcID: 4, id: '12345', test: false });
    expect(parse(s.dc4_auth_key)).toBe(AUTH_KEY);
    // The one value the client stores unencoded: `String(mainDcId)`.
    expect(s.dc).toBe('4');
  });

  // The whole point of moving off Web K: the account's own dc has to survive.
  it('keys the auth key by the account own dc and never touches dc 2', () => {
    const s = buildWebAStorage({ authKeyHex: AUTH_KEY, dcId: 5, userId: 7 });
    expect(parse(s.account1).dcId).toBe(5);
    expect(s.dc5_auth_key).toBeDefined();
    expect(s.dc2_auth_key).toBeUndefined();
  });

  it('normalises the auth key to the lowercase hex the client writes itself', () => {
    const s = buildWebAStorage({ authKeyHex: AUTH_KEY.toUpperCase(), dcId: 2, userId: 7 });
    expect(parse(s.dc2_auth_key)).toBe(AUTH_KEY);
  });

  it('rejects a key that is not 512 hex chars', () => {
    expect(() => buildWebAStorage({ authKeyHex: 'ab'.repeat(255), dcId: 2, userId: 7 })).toThrow();
    expect(() => buildWebAStorage({ authKeyHex: 'zz'.repeat(256), dcId: 2, userId: 7 })).toThrow();
  });

  it('rejects a dc outside production range', () => {
    expect(() => buildWebAStorage({ authKeyHex: AUTH_KEY, dcId: 0, userId: 7 })).toThrow();
    expect(() => buildWebAStorage({ authKeyHex: AUTH_KEY, dcId: 6, userId: 7 })).toThrow();
  });

  // Without a user id the window would open on a QR code; failing here says why.
  it('rejects a missing user id', () => {
    expect(() => buildWebAStorage({ authKeyHex: AUTH_KEY, dcId: 2, userId: 0 })).toThrow();
  });
});

describe('buildWebInjectionScript', () => {
  const script = buildWebInjectionScript(
    buildWebAStorage({ authKeyHex: AUTH_KEY, dcId: 4, userId: 7 }),
  );

  it('writes every entry through verbatim', () => {
    expect(script).toContain(JSON.stringify(JSON.stringify(AUTH_KEY)));
    expect(script).toContain('"dc4_auth_key"');
    expect(script).toContain('"account1"');
  });

  // A `kz_version` left by an earlier attempt bounces the window to the other client.
  it('clears the keys that would change which client boots', () => {
    for (const key of STALE_KEYS) expect(script).toContain(key);
    expect(script).toContain('removeItem');
  });

  it('plants at most once per window', () => {
    expect(script).toContain('__lzt_tg_injected');
  });

  // The reload belongs to main, which only issues it after taking the script blocker off.
  it('leaves the reload to the caller', () => {
    expect(script).not.toContain('location.reload');
  });

  it('refuses to run anywhere but telegram.org', () => {
    expect(script).toContain('telegram');
    expect(script).toContain('location.hostname');
  });
});

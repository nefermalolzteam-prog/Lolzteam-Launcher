import { describe, expect, it } from 'vitest';
import {
  extractAccountName,
  extractDeviceId,
  extractIdentitySecret,
  extractSharedSecret,
  extractSteamId,
  generateDeviceId,
  generateSteamGuardCode,
  parseMafile,
} from '../mafile';

/** A legacy SDA maFile, trimmed to the fields we read. */
const SDA_MAFILE = `{
  "shared_secret": "cnOgv/KdpLoP6Nbh0GMkXkPXALQ=",
  "serial_number": "9153815908645235792",
  "revocation_code": "R12345",
  "uri": "otpauth://totp/Steam:user?secret=ABC",
  "server_time": 1700000000,
  "account_name": "someuser",
  "token_gid": "abc123",
  "identity_secret": "CHQrSMFMK1SBQfDgUmzTJ5AzJ8g=",
  "secret_1": "zHGkzOOoTLHHkPQ+jvDCkfDMTG0=",
  "status": 1,
  "device_id": "android:11111111-2222-3333-4444-555555555555",
  "fully_enrolled": true,
  "Session": {
    "SessionID": "sess",
    "SteamLogin": null,
    "SteamLoginSecure": null,
    "WebCookie": null,
    "OAuthToken": null,
    "SteamID": 76561198012345678
  }
}`;

describe('generateSteamGuardCode', () => {
  it('produces the five-character Steam alphabet code for a known bucket', () => {
    // 30s bucket 56666666 — pinned so a refactor of the HMAC math is caught.
    const code = generateSteamGuardCode('cnOgv/KdpLoP6Nbh0GMkXkPXALQ=', 1700000000000);
    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/);
  });

  it('holds the code steady inside one 30-second bucket and changes across buckets', () => {
    const secret = 'cnOgv/KdpLoP6Nbh0GMkXkPXALQ=';
    // Aligned to a bucket boundary, or the +29s probe would straddle two.
    const base = 1700000010000;
    expect(generateSteamGuardCode(secret, base)).toBe(
      generateSteamGuardCode(secret, base + 29_000),
    );
    expect(generateSteamGuardCode(secret, base)).not.toBe(
      generateSteamGuardCode(secret, base + 30_000),
    );
  });
});

describe('maFile field extraction', () => {
  it('reads every field out of a legacy SDA maFile given as text', () => {
    const data = parseMafile(SDA_MAFILE);
    expect(data.sharedSecret).toBe('cnOgv/KdpLoP6Nbh0GMkXkPXALQ=');
    expect(data.identitySecret).toBe('CHQrSMFMK1SBQfDgUmzTJ5AzJ8g=');
    expect(data.deviceId).toBe('android:11111111-2222-3333-4444-555555555555');
    expect(data.accountName).toBe('someuser');
    expect(data.revocationCode).toBe('R12345');
    expect(data.steamId).toBe('76561198012345678');
  });

  it('reads the same fields from an already-parsed object', () => {
    const data = parseMafile(JSON.parse(SDA_MAFILE));
    expect(data.sharedSecret).toBe('cnOgv/KdpLoP6Nbh0GMkXkPXALQ=');
    expect(data.identitySecret).toBe('CHQrSMFMK1SBQfDgUmzTJ5AzJ8g=');
    expect(data.deviceId).toBe('android:11111111-2222-3333-4444-555555555555');
  });

  it('descends into the { maFile: … } envelope the market endpoint uses', () => {
    const wrapped = JSON.stringify({ maFile: JSON.parse(SDA_MAFILE) });
    expect(extractSharedSecret(wrapped)).toBe('cnOgv/KdpLoP6Nbh0GMkXkPXALQ=');
    expect(extractIdentitySecret(wrapped)).toBe('CHQrSMFMK1SBQfDgUmzTJ5AzJ8g=');
    expect(extractDeviceId(wrapped)).toBe('android:11111111-2222-3333-4444-555555555555');
    expect(extractAccountName(wrapped)).toBe('someuser');
  });

  it('accepts the camelCase and PascalCase spellings other tools emit', () => {
    const alt = {
      sharedSecret: 'AAAA',
      IdentitySecret: 'BBBB',
      DeviceId: 'android:x',
      AccountName: 'other',
    };
    expect(extractSharedSecret(alt)).toBe('AAAA');
    expect(extractIdentitySecret(alt)).toBe('BBBB');
    expect(extractDeviceId(alt)).toBe('android:x');
    expect(extractAccountName(alt)).toBe('other');
  });

  it('skips a blank field instead of returning an empty string', () => {
    expect(extractSharedSecret({ shared_secret: '   ', sharedSecret: 'real' })).toBe('real');
    expect(extractIdentitySecret({ identity_secret: '' })).toBeNull();
  });

  it('returns null for junk rather than throwing', () => {
    expect(extractSharedSecret('not json at all')).toBeNull();
    expect(extractSharedSecret(null)).toBeNull();
    expect(extractSharedSecret(42)).toBeNull();
    expect(extractSharedSecret([1, 2, 3])).toBeNull();
    expect(parseMafile('{')).toEqual({
      sharedSecret: null,
      identitySecret: null,
      deviceId: null,
      steamId: null,
      accountName: null,
      revocationCode: null,
    });
  });
});

describe('extractSteamId', () => {
  it('keeps every digit of an unquoted steamID64, which JSON.parse would round', () => {
    const raw = '{"Session":{"SteamID":76561198012345678}}';
    // Proof the guard is needed: the parsed number is already wrong.
    expect(String(JSON.parse(raw).Session.SteamID)).not.toBe('76561198012345678');
    expect(extractSteamId(raw)).toBe('76561198012345678');
  });

  it('reads a quoted steamid from either the root or the session block', () => {
    expect(extractSteamId('{"steamid":"76561198012345678"}')).toBe('76561198012345678');
    expect(extractSteamId({ Session: { SteamID: '76561198012345678' } })).toBe('76561198012345678');
  });

  it('ignores ids that are not 17 digits', () => {
    expect(extractSteamId('{"steamid":"123"}')).toBe('123');
    expect(extractSteamId('{"steamid":null}')).toBeNull();
  });
});

describe('generateDeviceId', () => {
  it('emits the android:<uuid> shape Steam expects, uniquely each time', () => {
    const id = generateDeviceId();
    expect(id).toMatch(/^android:[0-9a-f-]{36}$/);
    expect(generateDeviceId()).not.toBe(id);
  });
});

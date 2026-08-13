import { describe, expect, it } from 'vitest';
import { isMobileAccessToken, isTokenExpired, readTokenClaims } from '../jwt';

const jwt = (payload: Record<string, unknown>): string =>
  `eyJ0eXAiOiJKV1QifQ.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

const MOBILE_ACCESS = jwt({ sub: '76561198012345678', aud: ['web', 'mobile'], exp: 2_000_000_000 });
const REFRESH = jwt({ sub: '76561198012345678', aud: ['mobile', 'derive'], exp: 2_000_000_000 });
const WEB_ACCESS = jwt({ sub: '76561198012345678', aud: ['web', 'client'], exp: 2_000_000_000 });

describe('readTokenClaims', () => {
  it('reads the steamid, expiry and audience Steam puts in its tokens', () => {
    const claims = readTokenClaims(MOBILE_ACCESS);
    expect(claims?.sub).toBe('76561198012345678');
    expect(claims?.exp).toBe(2_000_000_000);
    expect(claims?.aud).toEqual(['web', 'mobile']);
  });

  it('accepts a single-string audience as well as an array', () => {
    expect(readTokenClaims(jwt({ aud: 'mobile' }))?.aud).toEqual(['mobile']);
  });

  it('returns null for anything that is not a readable token', () => {
    expect(readTokenClaims('')).toBeNull();
    expect(readTokenClaims('not.a.jwt')).toBeNull();
    expect(readTokenClaims('onlyonesegment')).toBeNull();
  });
});

describe('isMobileAccessToken', () => {
  it('accepts the token LoginApprover requires', () => {
    expect(isMobileAccessToken(MOBILE_ACCESS)).toBe(true);
  });

  it('rejects a refresh token, which carries the derive audience', () => {
    expect(isMobileAccessToken(REFRESH)).toBe(false);
  });

  it('rejects a token minted for the browser rather than the mobile app', () => {
    expect(isMobileAccessToken(WEB_ACCESS)).toBe(false);
  });

  it('rejects junk instead of letting it reach the library', () => {
    expect(isMobileAccessToken('garbage')).toBe(false);
  });
});

describe('isTokenExpired', () => {
  it('is false well before the expiry', () => {
    expect(isTokenExpired(MOBILE_ACCESS, 1_999_000_000)).toBe(false);
  });

  it('is true after the expiry', () => {
    expect(isTokenExpired(MOBILE_ACCESS, 2_000_000_001)).toBe(true);
  });

  it('retires a token early, so a slow request cannot outlive it', () => {
    expect(isTokenExpired(MOBILE_ACCESS, 1_999_999_999 - 200)).toBe(true);
  });

  it('treats a token with no expiry as spent', () => {
    expect(isTokenExpired(jwt({ aud: ['mobile'] }))).toBe(true);
  });
});

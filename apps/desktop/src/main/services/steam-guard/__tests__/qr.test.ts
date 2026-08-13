import { describe, expect, it } from 'vitest';
import { buildQrChallengeUrl, findQrChallengeUrl } from '../qr';

describe('findQrChallengeUrl', () => {
  it('accepts the bare URL a QR decoder produces', () => {
    expect(findQrChallengeUrl('https://s.team/q/1/9876543210123456789')).toBe(
      'https://s.team/q/1/9876543210123456789',
    );
  });

  it('accepts http as well as https', () => {
    expect(findQrChallengeUrl('http://s.team/q/1/123')).toBe('http://s.team/q/1/123');
  });

  it('keeps the query string, which Steam puts there itself', () => {
    expect(findQrChallengeUrl('https://s.team/q/1/123?l=english')).toBe(
      'https://s.team/q/1/123?l=english',
    );
  });

  it('ignores whitespace around a pasted link', () => {
    expect(findQrChallengeUrl('  https://s.team/q/1/123\n')).toBe('https://s.team/q/1/123');
  });

  it('finds the link inside a message copied out of a chat', () => {
    expect(findQrChallengeUrl('подтверди пожалуйста https://s.team/q/1/123 спасибо')).toBe(
      'https://s.team/q/1/123',
    );
  });

  it('refuses a look-alike host instead of handing it to Steam', () => {
    expect(findQrChallengeUrl('https://s.team.evil.com/q/1/123')).toBeNull();
    expect(findQrChallengeUrl('https://steamcommunity.com/q/1/123')).toBeNull();
  });

  it('refuses a URL with the wrong shape', () => {
    expect(findQrChallengeUrl('https://s.team/q/1')).toBeNull();
    expect(findQrChallengeUrl('https://s.team/q/abc/123')).toBeNull();
  });

  it('refuses junk', () => {
    expect(findQrChallengeUrl('')).toBeNull();
    expect(findQrChallengeUrl('   ')).toBeNull();
    expect(findQrChallengeUrl('76561198012345678')).toBeNull();
  });
});

/** The URL a credentials login gets approved through is assembled here, not read off a screen. */
describe('buildQrChallengeUrl', () => {
  it('builds a URL its own parser accepts', () => {
    const url = buildQrChallengeUrl(1, '9876543210123456789');
    expect(url).toBe('https://s.team/q/1/9876543210123456789');
    expect(findQrChallengeUrl(url)).toBe(url);
  });

  it('keeps a 64-bit client id exactly as given', () => {
    // Through Number this one comes back as ...5808, and Steam would be asked to approve a session that does not exist.
    const clientId = '9223372036854775807';
    expect(buildQrChallengeUrl(2, clientId).endsWith(`/${clientId}`)).toBe(true);
  });
});

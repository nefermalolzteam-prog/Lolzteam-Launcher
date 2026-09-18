import { describe, expect, it } from 'vitest';
import { computeConnectCacheHdr, encryptConnectCacheToken } from '../connect-cache';
import { linuxNativeLayout, win32Layout } from '../layout';
import { valveSymmetricDecrypt } from '../valve-crypto';

describe('computeConnectCacheHdr', () => {
  // The key the Steam client writes into `local.vdf`: crc32 of the lowercased
  // login, hex, with a trailing `1`. Reproduced from the construction rather
  // than captured from an account.
  it('matches the key the Steam client writes', () => {
    expect(computeConnectCacheHdr('testaccount')).toBe('13dcb6091');
  });

  it('lowercases before hashing, as the client does', () => {
    expect(computeConnectCacheHdr('TestUser')).toBe('b98513741');
    expect(computeConnectCacheHdr('testuser')).toBe('b98513741');
  });
});

describe('encryptConnectCacheToken', () => {
  it('uses Valve symmetric encryption on Linux', async () => {
    const layout = linuxNativeLayout('/home/u/.local/share/Steam', '/home/u');
    const hex = await encryptConnectCacheToken(layout, 'token-value', 'someaccount');
    expect(valveSymmetricDecrypt(Buffer.from(hex, 'hex'), 'someaccount').toString('utf8')).toBe(
      'token-value',
    );
  });

  it('routes Windows through DPAPI, which is unavailable off Windows', async () => {
    const layout = win32Layout('C:\\Steam', 'C:\\Users\\u\\AppData\\Local');
    // The DPAPI helper's own refusal, not some other failure on the way there.
    await expect(encryptConnectCacheToken(layout, 'token-value', 'someaccount')).rejects.toThrow(
      /DPAPI is only available on Windows/,
    );
  });
});

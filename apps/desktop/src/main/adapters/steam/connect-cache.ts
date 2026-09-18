import { dpapiProtect } from './dpapi';
import type { SteamLayout } from './layout';
import { valveSymmetricEncrypt } from './valve-crypto';

// `local.vdf` holds one entry per account under `.../Steam/ConnectCache`, keyed
// by a checksum of the account name and holding the refresh token the client
// signs in with. Both halves differ per platform:
//
//   key         crc32(lowercase(accountName)) in hex, with "1" appended
//   value       Windows: DPAPI blob (CurrentUser scope, account name as entropy)
//               Linux:   Valve's AES-256 SymmetricEncrypt over the same name
//
// The key is shared; only the encryption differs.

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// Steam lowercases the account name before hashing. For the all-lowercase names
// Steam hands back from a login this is a no-op; for anything else, skipping it
// would write an entry under a key the client never looks up.
export const computeConnectCacheHdr = (login: string): string => {
  const value = crc32(Buffer.from(login.toLowerCase(), 'utf8'));
  return `${value.toString(16)}1`;
};

/** Encrypts `refreshToken` the way the client for `layout` expects, as hex. */
export const encryptConnectCacheToken = async (
  layout: SteamLayout,
  refreshToken: string,
  login: string,
): Promise<string> => {
  const plaintext = Buffer.from(refreshToken, 'utf8');
  if (layout.flavor === 'win32') {
    return dpapiProtect(plaintext, Buffer.from(login, 'utf8'));
  }
  return valveSymmetricEncrypt(plaintext, login).toString('hex');
};

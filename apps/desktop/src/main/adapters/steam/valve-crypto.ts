import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Valve's `CCrypto::SymmetricEncrypt`, the scheme the Steam client uses for the
// ConnectCache refresh-token blob on Linux and macOS. Windows wraps the same
// slot in DPAPI instead, which is why `dpapi.ts` exists alongside this file.
//
//   key    = SHA256(utf8(lowercase(accountName)))
//   blob   = AES-256-ECB(IV, key, no padding)          // 16 bytes
//         ++ AES-256-CBC(plaintext, key, IV, PKCS#7)
//
// The account name is the whole secret: anyone who can read `local.vdf` can
// read the token. That is Valve's design, not ours — the client has to be able
// to decrypt it unattended, and we have to produce a blob it accepts.
//
// Verified byte-for-byte against a real `local.vdf` written by Steam: decrypting
// a client-written blob yields the bare refresh JWT, and re-encrypting it with
// the same IV reproduces the file exactly.

const keyFor = (accountName: string): Buffer =>
  createHash('sha256').update(accountName.toLowerCase(), 'utf8').digest();

const ecbBlock = (key: Buffer, block: Buffer, encrypt: boolean): Buffer => {
  const cipher = encrypt
    ? createCipheriv('aes-256-ecb', key, null)
    : createDecipheriv('aes-256-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
};

export const valveSymmetricEncrypt = (
  plaintext: Buffer,
  accountName: string,
  iv: Buffer = randomBytes(16),
): Buffer => {
  if (iv.length !== 16) throw new Error(`IV must be 16 bytes, got ${iv.length}`);
  const key = keyFor(accountName);
  const cbc = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([ecbBlock(key, iv, true), cbc.update(plaintext), cbc.final()]);
};

export const valveSymmetricDecrypt = (blob: Buffer, accountName: string): Buffer => {
  if (blob.length < 32 || blob.length % 16 !== 0) {
    throw new Error(`ConnectCache blob has implausible length ${blob.length}`);
  }
  const key = keyFor(accountName);
  const iv = ecbBlock(key, blob.subarray(0, 16), false);
  const cbc = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([cbc.update(blob.subarray(16)), cbc.final()]);
};

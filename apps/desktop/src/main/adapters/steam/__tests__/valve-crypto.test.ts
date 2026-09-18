import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { valveSymmetricDecrypt, valveSymmetricEncrypt } from '../valve-crypto';

// Fixed vector for the scheme the Steam client uses on Linux and macOS:
//   key  = SHA256(utf8(lowercase(accountName)))
//   blob = AES-256-ECB(IV, key, no padding) ++ AES-256-CBC(plaintext, key, IV)
// Reproduced independently from the construction, not captured from our own
// output, so a change to any of the three moving parts fails this test.
const ACCOUNT = 'TestUser';
const IV = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const PLAINTEXT = 'eyJhbGciOiJFZERTQSJ9.payload.sig';
const GOLDEN =
  '96ab0bd1650863d6e93ba9252a8c18871bf9b05635c4b93de110a68fa72168e4' +
  'bd30d96faaa0fb8a0e0f2271fe591ee479103c3ca7a195fd73a607cfc7f6e7f7';

describe('valveSymmetricEncrypt', () => {
  it('reproduces the golden blob for a known account, IV and plaintext', () => {
    const blob = valveSymmetricEncrypt(Buffer.from(PLAINTEXT, 'utf8'), ACCOUNT, IV);
    expect(blob.toString('hex')).toBe(GOLDEN);
  });

  it('derives the key from the lowercased account name', () => {
    expect(createHash('sha256').update('testuser', 'utf8').digest('hex')).toBe(
      'ae5deb822e0d71992900471a7199d0d95b8e7c9d05c40a8245a281fd2c1d6684',
    );
    // Same key ⇒ a blob written under one casing decrypts under the other.
    const blob = valveSymmetricEncrypt(Buffer.from(PLAINTEXT, 'utf8'), 'TESTUSER', IV);
    expect(valveSymmetricDecrypt(blob, 'testuser').toString('utf8')).toBe(PLAINTEXT);
  });

  it('prefixes the blob with the ECB-wrapped IV and PKCS#7-pads the body', () => {
    const blob = valveSymmetricEncrypt(Buffer.from(PLAINTEXT, 'utf8'), ACCOUNT, IV);
    // 16 IV bytes + 32 plaintext bytes rounded up to a full extra block.
    expect(blob.length).toBe(16 + 48);
  });

  it('picks a fresh random IV when none is given', () => {
    const a = valveSymmetricEncrypt(Buffer.from(PLAINTEXT, 'utf8'), ACCOUNT);
    const b = valveSymmetricEncrypt(Buffer.from(PLAINTEXT, 'utf8'), ACCOUNT);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(valveSymmetricDecrypt(a, ACCOUNT).toString('utf8')).toBe(PLAINTEXT);
    expect(valveSymmetricDecrypt(b, ACCOUNT).toString('utf8')).toBe(PLAINTEXT);
  });

  it('rejects an IV that is not one AES block', () => {
    expect(() => valveSymmetricEncrypt(Buffer.alloc(4), ACCOUNT, Buffer.alloc(8))).toThrow(
      /16 bytes/,
    );
  });
});

describe('valveSymmetricDecrypt', () => {
  it('round-trips a realistic 493-byte refresh token', () => {
    const token = `eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSJ9.${'x'.repeat(440)}.sig`;
    const blob = valveSymmetricEncrypt(Buffer.from(token, 'utf8'), 'someaccount');
    expect(valveSymmetricDecrypt(blob, 'someaccount').toString('utf8')).toBe(token);
  });

  it('rejects a blob that cannot be a wrapped IV plus at least one block', () => {
    expect(() => valveSymmetricDecrypt(Buffer.alloc(16), ACCOUNT)).toThrow(/implausible length/);
    expect(() => valveSymmetricDecrypt(Buffer.alloc(33), ACCOUNT)).toThrow(/implausible length/);
  });

  it('fails loudly under the wrong account name rather than returning garbage', () => {
    const blob = valveSymmetricEncrypt(Buffer.from(PLAINTEXT, 'utf8'), ACCOUNT);
    expect(() => valveSymmetricDecrypt(blob, 'someoneelse')).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { countryFromPhone } from '../geo';

describe('countryFromPhone', () => {
  it('reads the number in every shape the store keeps it in', () => {
    expect(countryFromPhone('+7 900 123-45-67')).toBe('RU');
    expect(countryFromPhone('79001234567')).toBe('RU');
    expect(countryFromPhone('+79001234567')).toBe('RU');
  });

  it('splits +7 between Russia and Kazakhstan', () => {
    expect(countryFromPhone('+77012345678')).toBe('KZ');
    expect(countryFromPhone('+76012345678')).toBe('KZ');
    expect(countryFromPhone('+74951234567')).toBe('RU');
  });

  it('resolves +1 by area code', () => {
    expect(countryFromPhone('+12125550123')).toBe('US');
    expect(countryFromPhone('+14165550123')).toBe('CA');
    expect(countryFromPhone('+18095550123')).toBe('DO');
    expect(countryFromPhone('+17875550123')).toBe('PR');
  });

  it('prefers the longest prefix', () => {
    // +35 is not a country; +351 and +358 are.
    expect(countryFromPhone('+351912345678')).toBe('PT');
    expect(countryFromPhone('+358401234567')).toBe('FI');
    // +3 must never win over +38 / +380.
    expect(countryFromPhone('+380501234567')).toBe('UA');
    expect(countryFromPhone('+38640123456')).toBe('SI');
  });

  it('covers the codes the database is actually full of', () => {
    expect(countryFromPhone('+375291234567')).toBe('BY');
    expect(countryFromPhone('+998901234567')).toBe('UZ');
    expect(countryFromPhone('+84901234567')).toBe('VN');
    expect(countryFromPhone('+62811234567')).toBe('ID');
    expect(countryFromPhone('+441234567890')).toBe('GB');
    expect(countryFromPhone('+491701234567')).toBe('DE');
  });

  it('refuses to guess for anonymous and test numbers', () => {
    // Fragment numbers are deliberately country-less.
    expect(countryFromPhone('+8880123456')).toBeNull();
    expect(countryFromPhone('+9996612345')).toBeNull();
  });

  it('returns null instead of a wrong flag', () => {
    expect(countryFromPhone(null)).toBeNull();
    expect(countryFromPhone('')).toBeNull();
    expect(countryFromPhone('+123')).toBeNull();
    // +999 is unassigned.
    expect(countryFromPhone('+99912345678')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { initialsOf } from '../InitialsAvatar';

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('KUMBA Killer Urbain')).toBe('KK');
    expect(initialsOf('Mathgofast')).toBe('M');
  });

  it('survives the punctuation Telegram names are full of', () => {
    // Extra spaces, and a name that is one long word with no break in it.
    expect(initialsOf('  pavel   durov ')).toBe('PD');
    expect(initialsOf('日本語')).toBe('日');
  });

  it('keeps a leading emoji whole instead of slicing the surrogate pair', () => {
    expect(initialsOf('🔥 Ivan')).toBe('🔥I');
  });

  it('gives nothing back for a name that is nothing', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf('   ')).toBe('');
  });
});

import type { AccountDetails } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { extractEaCreds } from '../extract';

const details = (secrets: Record<string, unknown>, extra: Partial<AccountDetails> = {}) =>
  ({
    itemId: 1,
    category: 'ea',
    categoryRaw: 'ea',
    categoryTitle: 'EA (Origin)',
    title: 'EA acc',
    description: '',
    price: 0,
    currency: 'rub',
    imageUrl: null,
    tags: [],
    warrantyEndsAt: null,
    publishedAt: null,
    purchasedAt: null,
    isPurchased: true,
    scope: 'purchased',
    steam: null,
    telegram: null,
    discord: null,
    instagram: null,
    tiktok: null,
    llmService: null,
    llm: null,
    hasEmailLogin: true,
    hasMafile: null,
    note: null,
    folder: null,
    marketItemId: null,
    localCopyId: null,
    loginRaw: null,
    passwordRaw: null,
    secrets,
    owned: true,
    ...extra,
  }) as AccountDetails;

describe('extractEaCreds', () => {
  it('reads email and password out of loginData', () => {
    expect(
      extractEaCreds(details({ loginData: { login: 'mail@example.com', password: 'pw' } })),
    ).toEqual({ email: 'mail@example.com', password: 'pw' });
  });

  it('falls back to the item-level account fields, then to the raw ones', () => {
    expect(extractEaCreds(details({ email: 'a@b.c' }, { passwordRaw: 'pw2' }))).toEqual({
      email: 'a@b.c',
      password: 'pw2',
    });
  });

  it('refuses an account without a password', () => {
    expect(extractEaCreds(details({ email: 'a@b.c' }))).toBeNull();
    expect(extractEaCreds(details({}))).toBeNull();
  });

  it('trims whitespace around both halves', () => {
    expect(extractEaCreds(details({ login: '  mail@example.com  ', password: '  pw  ' }))).toEqual({
      email: 'mail@example.com',
      password: 'pw',
    });
  });
});

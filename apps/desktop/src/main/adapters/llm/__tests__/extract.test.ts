import type { AccountDetails } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { extractEmailCreds, resolveLlmCookies } from '../extract';

const baseDetails = (secrets: Record<string, unknown>): AccountDetails => ({
  itemId: 1,
  category: 'llm',
  categoryRaw: '6',
  categoryTitle: 'Claude',
  title: 'Claude Max',
  description: '',
  price: 0,
  currency: 'RUB',
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
  hasEmailLogin: false,
  hasMafile: null,
  folder: null,
  note: null,
  marketItemId: null,
  localCopyId: null,
  loginRaw: null,
  passwordRaw: null,
  secrets,
  owned: true,
});

const CLAUDE_PROVIDER = {
  provider: 'claude' as const,
  displayName: 'Claude',
  loginKind: 'session-cookie' as const,
  cookieDomain: '.claude.ai',
  cookieName: 'sessionKey',
  landingUrl: 'https://claude.ai/',
};

describe('extractEmailCreds (ChatGPT)', () => {
  it('reads email:password from emailLoginData', () => {
    const details = baseDetails({
      emailLoginData: { login: 'a@b.com', password: 'pw123' },
    });
    expect(extractEmailCreds(details)).toEqual({ email: 'a@b.com', password: 'pw123' });
  });

  it('falls back to account_login / account_password', () => {
    const details = baseDetails({ account_login: 'x@y.com', account_password: 'secret' });
    expect(extractEmailCreds(details)).toEqual({ email: 'x@y.com', password: 'secret' });
  });

  it('returns null when only one of email/password is present', () => {
    expect(extractEmailCreds(baseDetails({ account_login: 'x@y.com' }))).toBeNull();
  });

  it('returns null when nothing usable is present', () => {
    expect(extractEmailCreds(baseDetails({}))).toBeNull();
  });
});

describe('resolveLlmCookies (Claude session)', () => {
  it('synthesizes a sessionKey cookie from a bare key', () => {
    const cookies = resolveLlmCookies(
      baseDetails({ sessionKey: 'sk-ant-sid01-bareKeyValue1234567' }),
      CLAUDE_PROVIDER,
    );
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: 'sessionKey',
      value: 'sk-ant-sid01-bareKeyValue1234567',
      domain: '.claude.ai',
    });
  });

  it('returns [] when nothing usable is present', () => {
    expect(resolveLlmCookies(baseDetails({}), CLAUDE_PROVIDER)).toEqual([]);
  });
});

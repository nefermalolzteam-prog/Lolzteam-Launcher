import type { AccountSummary, SteamCheckRecord, TelegramProfile } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { lastCheckedAt, resolveAccountValidity } from '../accountValidity';

const VALID_TAG = { id: 1, title: 'Валид', bc: '#0f0' };
const INVALID_TAG = { id: 2, title: 'Невалид', bc: '#f00' };

const profile = (status: TelegramProfile['status'], checkedAt = 0): TelegramProfile => ({
  accountId: 1,
  status,
  userId: null,
  phone: null,
  username: null,
  name: '',
  premium: false,
  country: null,
  spam: null,
  sessions: null,
  hasAvatar: false,
  checkedAt,
  detail: null,
});

const check = (status: SteamCheckRecord['status'], checkedAt = 0): SteamCheckRecord => ({
  accountId: 1,
  status,
  steamId: null,
  nickname: null,
  vacBanned: null,
  tradeBanState: null,
  limited: null,
  privacy: null,
  memberSince: null,
  avatarUrl: null,
  detail: null,
  checkedAt,
});

describe('resolveAccountValidity', () => {
  it('says nothing about an account nobody has checked and the market never tagged', () => {
    expect(resolveAccountValidity([], undefined, undefined)).toBe('unknown');
    expect(resolveAccountValidity(null, undefined, undefined)).toBe('unknown');
  });

  it('reads the market tags when they are the only answer', () => {
    expect(resolveAccountValidity([VALID_TAG], undefined, undefined)).toBe('valid');
    expect(resolveAccountValidity([INVALID_TAG], undefined, undefined)).toBe('invalid');
  });

  it('turns a Telegram check into a verdict', () => {
    expect(resolveAccountValidity([], profile('alive'), undefined)).toBe('valid');
    expect(resolveAccountValidity([], profile('frozen'), undefined)).toBe('invalid');
    expect(resolveAccountValidity([], profile('dead'), undefined)).toBe('invalid');
  });

  it('turns a Steam check into a verdict, and keeps «unlinked» honest', () => {
    expect(resolveAccountValidity([], undefined, check('alive'))).toBe('valid');
    expect(resolveAccountValidity([], undefined, check('dead'))).toBe('invalid');
    // Nothing was learned about the account — only that we have no session for it.
    expect(resolveAccountValidity([], undefined, check('unlinked'))).toBe('unknown');
    expect(resolveAccountValidity([VALID_TAG], undefined, check('unlinked'))).toBe('valid');
  });

  // What we saw ourselves outranks a tag the market wrote when the item sold.
  it('lets our own check overrule the market tag', () => {
    expect(resolveAccountValidity([VALID_TAG], profile('dead'), undefined)).toBe('invalid');
    expect(resolveAccountValidity([INVALID_TAG], undefined, check('alive'))).toBe('valid');
  });
});

describe('lastCheckedAt', () => {
  const item = { itemId: 42 } as AccountSummary;
  const src = (p?: TelegramProfile, c?: SteamCheckRecord) => ({
    profiles: new Map(p ? [[42, p]] : []),
    checks: new Map(c ? [[42, c]] : []),
  });

  it('is null for an account no sidecar knows', () => {
    expect(lastCheckedAt(item, src())).toBeNull();
  });

  it('takes whichever sidecar answered', () => {
    expect(lastCheckedAt(item, src(profile('alive', 700)))).toBe(700);
    expect(lastCheckedAt(item, src(undefined, check('alive', 900)))).toBe(900);
  });

  it('takes the newer of the two when both did', () => {
    expect(lastCheckedAt(item, src(profile('alive', 700), check('alive', 900)))).toBe(900);
    expect(lastCheckedAt(item, src(profile('alive', 1200), check('alive', 900)))).toBe(1200);
  });
});

import type { AccountDetails } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { couldBeEmail, mailboxFor, mailboxPairFor } from '../mailbox';

const details = (
  secrets: Record<string, unknown>,
  extra: Partial<AccountDetails> = {},
): AccountDetails => ({
  itemId: 1,
  category: 'discord',
  categoryRaw: '14',
  categoryTitle: 'Discord',
  title: 'Discord',
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
  ...extra,
});

/** Выдуманный токен бота в той форме, в какой его присылают вместо адреса. */
const DISCORD_TOKEN = 'ExampleBotTokenAAAAAAAAA.Xm9pQr.0123456789abcdefghijklmnopq';

describe('couldBeEmail', () => {
  it('повторяет проверку сервера: `@` не в первом символе', () => {
    expect(couldBeEmail('a@b.com')).toBe(true);
    expect(couldBeEmail('@b.com')).toBe(false);
    expect(couldBeEmail('')).toBe(false);
    expect(couldBeEmail(DISCORD_TOKEN)).toBe(false);
  });
});

describe('mailboxFor', () => {
  it('берёт пару из emailLoginData', () => {
    expect(mailboxFor(details({ emailLoginData: { login: 'a@b.com', password: 'pw' } }))).toEqual({
      login: 'a@b.com',
      password: 'pw',
    });
  });

  it('понимает snake_case-написание того же поля', () => {
    expect(mailboxFor(details({ email_login_data: { login: 'a@b.com', password: 'pw' } }))).toEqual(
      {
        login: 'a@b.com',
        password: 'pw',
      },
    );
  });

  it('разбирает строку `login:password`, оставляя двоеточие в пароле', () => {
    expect(mailboxFor(details({ emailLoginData: 'a@b.com:pw:with:colons' }))).toEqual({
      login: 'a@b.com',
      password: 'pw:with:colons',
    });
  });

  it('нормализует разделители так же, как это делает letters2', () => {
    expect(mailboxFor(details({ emailLoginData: 'a@b.com;pw' }))?.password).toBe('pw');
    expect(mailboxFor(details({ emailLoginData: 'a@b.com|pw' }))?.password).toBe('pw');
    expect(mailboxFor(details({ emailLoginData: 'a@b.com pw' }))?.password).toBe('pw');
  });

  it('не принимает токен Discord за почту', () => {
    const account = details(
      { loginData: { login: DISCORD_TOKEN, password: 'pw' }, account_login: DISCORD_TOKEN },
      { loginRaw: DISCORD_TOKEN, passwordRaw: 'pw' },
    );
    expect(mailboxFor(account)).toBeNull();
    expect(mailboxPairFor(account)).toBeNull();
  });

  it('не выдаёт ящик за собственный логин аккаунта, даже если тот похож на адрес', () => {
    expect(
      mailboxFor(details({ account_login: 'buyer@mail.com', account_password: 'pw' })),
    ).toBeNull();
  });

  it('молчит, когда в паре нет пароля', () => {
    expect(mailboxFor(details({ emailLoginData: { login: 'a@b.com' } }))).toBeNull();
  });

  it('молчит, когда логин из emailLoginData не похож на адрес', () => {
    expect(
      mailboxFor(details({ emailLoginData: { login: 'someLogin', password: 'pw' } })),
    ).toBeNull();
  });

  it('молчит на пустом товаре', () => {
    expect(mailboxFor(details({}))).toBeNull();
  });
});

describe('mailboxPairFor', () => {
  it('склеивает пару в форму, которую понимает letters2', () => {
    expect(mailboxPairFor(details({ emailLoginData: { login: 'a@b.com', password: 'pw' } }))).toBe(
      'a@b.com:pw',
    );
  });
});

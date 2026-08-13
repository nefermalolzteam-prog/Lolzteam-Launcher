import type { AccountDetails, MailCredentials } from '@shared-types';

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
};

/** Проверка сервера, повторённая слово в слово: `XenForo_Model_User::couldBeEmail()` — непустая строка. */
export const couldBeEmail = (value: string): boolean => value.slice(1).includes('@');

/** `emailLoginData` в ответе API — объект `{login, password}`. */
const parsePair = (raw: unknown): MailCredentials | null => {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const login = str(o.login);
    const password = str(o.password);
    return login && password ? { login, password } : null;
  }
  const text = str(raw);
  if (!text) return null;
  const at = text.replace(/[ ;|]/g, ':').indexOf(':');
  if (at <= 0) return null;
  const login = str(text.slice(0, at));
  const password = str(text.slice(at + 1));
  return login && password ? { login, password } : null;
};

/** Почтовый ящик товара — или `null`, если маркет его не давал. */
export const mailboxFor = (details: AccountDetails): MailCredentials | null => {
  const secrets = details.secrets ?? {};
  const pair = parsePair(secrets.emailLoginData) ?? parsePair(secrets.email_login_data);
  if (!pair || !couldBeEmail(pair.login)) return null;
  return pair;
};

/** Тот же ящик в виде `login:password` — форма, которую понимают и `letters2`, и поле ввода на странице «Почта». */
export const mailboxPairFor = (details: AccountDetails): string | null => {
  const box = mailboxFor(details);
  return box ? `${box.login}:${box.password}` : null;
};

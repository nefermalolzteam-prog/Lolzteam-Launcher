import type { MailLetter } from '@shared-types';

/** Сколько символов тела показываем во второй строке письма. */
export const PREVIEW_MAX = 160;

export interface Credentials {
  email: string;
  password: string;
}

/** Разбор `email:password`. */
export const splitCredentials = (raw: string): Credentials | null => {
  const value = raw.trim();
  const at = value.indexOf(':');
  if (at <= 0) return null;
  const email = value.slice(0, at).trim();
  const password = value.slice(at + 1);
  if (!email || !password) return null;
  return { email, password };
};

/** Обратная операция: в истории пара по-прежнему лежит одной строкой. */
export const joinCredentials = (c: Credentials): string => `${c.email}:${c.password}`;

/** Что показать на фишке недавней почты — адрес, но не пароль. */
export const emailOf = (entry: string): string => splitCredentials(entry)?.email ?? entry.trim();

/* ── Код подтверждения ─────────────────────────────────────────────────── */

/** Слова, рядом с которыми число — код, а не число. */
const CODE_WORD =
  /code|codigo|otp|pin\b|passcode|verif|confirm|security|auth|код|кода|пароль|подтвер/gi;

/** Токен, который вообще может быть кодом. */
const CODE_TOKEN = /(?<![\p{L}\d.:\/=&?_+%-])([A-Z0-9]{4,8})(?![\p{L}\d:\/=&?_+%-])(?!\.\d)/gu;

/** Код Steam Guard: ровно пять знаков из его собственного алфавита. */
const STEAM_CODE = /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/;

/** Похоже ли на код. */
const looksLikeCode = (token: string): boolean => /\d/.test(token) || STEAM_CODE.test(token);

/** Как далеко от токена ещё может стоять слово-подсказка. */
const NEAR_BEFORE = 140;
const NEAR_AFTER = 24;

/** Слова-подсказки с их местом в тексте — по ним меряется близость кандидата. */
const hints = (hay: string): Array<[number, number]> =>
  [...hay.matchAll(CODE_WORD)].map((m) => {
    const at = m.index ?? 0;
    return [at, at + m[0].length];
  });

/** Расстояние от токена до ближайшей подсказки — или `null`, если её нет рядом. */
const hintGap = (
  spans: ReadonlyArray<[number, number]>,
  at: number,
  end: number,
): number | null => {
  let best: number | null = null;
  for (const [from, to] of spans) {
    const gap = to <= at ? at - to : from >= end ? from - end : 0;
    const limit = to <= at ? NEAR_BEFORE : NEAR_AFTER;
    if (gap <= limit && (best === null || gap < best)) best = gap;
  }
  return best;
};

/** Код подтверждения из письма — или `null`. */
export const findCode = (subject: string | null, text: string): string | null => {
  const hay = `${subject ?? ''} ${text}`.replace(/\s+/g, ' ');
  const spans = hints(hay);
  if (spans.length === 0) return null;
  let code: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const m of hay.matchAll(CODE_TOKEN)) {
    const token = m[1];
    if (!token || !looksLikeCode(token)) continue;
    const at = m.index ?? 0;
    const gap = hintGap(spans, at, at + token.length);
    if (gap !== null && gap < best) {
      code = token;
      best = gap;
    }
  }
  return code;
};

/** Тело письма, приведённое к читаемому виду. */
export const tidyPlainText = (text: string): string =>
  text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/* ── Письмо как строка списка ──────────────────────────────────────────── */

/** Письмо, разобранное один раз. */
export interface LetterFacts {
  letter: MailLetter;
  /** Тело письма простым текстом — вьюха уже развернула HTML. */
  text: string;
  /** Одной строкой, обрезано до `PREVIEW_MAX`. */
  preview: string;
  /** Код подтверждения, если письмо его несёт. */
  code: string | null;
}

export const letterFacts = (letter: MailLetter, text: string): LetterFacts => ({
  letter,
  text,
  preview: text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX),
  code: findCode(letter.subject, text),
});

/** Поиск идёт по теме, отправителю и телу. */
export const matchesQuery = (facts: LetterFacts, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { letter } = facts;
  return (
    (letter.subject ?? '').toLowerCase().includes(q) ||
    (letter.from ?? '').toLowerCase().includes(q) ||
    facts.text.toLowerCase().includes(q)
  );
};

export const filterLetters = (
  facts: readonly LetterFacts[],
  query: string,
  onlyCodes: boolean,
): LetterFacts[] =>
  facts.filter((f) => (onlyCodes ? f.code !== null : true) && matchesQuery(f, query));

export const countCodes = (facts: readonly LetterFacts[]): number =>
  facts.reduce((n, f) => (f.code === null ? n : n + 1), 0);

/* ── Дата ──────────────────────────────────────────────────────────────── */

/** Насколько подробно писать дату в правой колонке. */
export type DateBucket = 'time' | 'day' | 'date';

export const dateBucket = (sec: number, now: number): DateBucket => {
  const d = new Date(sec * 1000);
  const n = new Date(now);
  if (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  ) {
    return 'time';
  }
  return d.getFullYear() === n.getFullYear() ? 'day' : 'date';
};

const OPTIONS: Record<DateBucket, Intl.DateTimeFormatOptions> = {
  time: { hour: '2-digit', minute: '2-digit' },
  day: { day: 'numeric', month: 'short' },
  date: { day: '2-digit', month: '2-digit', year: 'numeric' },
};

const localeTag = (locale: string) => (locale.startsWith('ru') ? 'ru-RU' : 'en-US');

/** Короткая дата для колонки. */
export const formatShortDate = (
  sec: number | null,
  locale: string,
  now: number = Date.now(),
): string | null => {
  if (sec === null) return null;
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(localeTag(locale), OPTIONS[dateBucket(sec, now)]).format(d);
};

/** Полная дата со временем — для подсказки над короткой. */
export const formatFullDate = (sec: number | null, locale: string): string | null => {
  if (sec === null) return null;
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(localeTag(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

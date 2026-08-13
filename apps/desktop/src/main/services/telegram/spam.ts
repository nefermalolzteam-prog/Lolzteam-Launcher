import type { TelegramSpamStatus, TelegramSpamVerdict } from '@shared-types';

/** "Good news, no limits are currently applied to your account." */
const FREE = [
  /free as a bird/i,
  /no limits are currently applied/i,
  /свободны,? как птица/i,
  /никаких ограничений/i,
  /ограничени[йя] (?:на ваш аккаунт )?не (?:наложено|применяется)/i,
];

/** The bot says the restriction will not be lifted by waiting. */
const PERMANENT = [
  /permanently/i,
  /will not be lifted/i,
  /навсегда/i,
  /не будет снят/i,
  /бессрочно/i,
];

/** Something is wrong, whether or not a date came with it. */
const LIMITED = [
  /your account (?:is|was|has been) (?:now )?limited/i,
  /some limitations/i,
  /restricted/i,
  /ваш аккаунт (?:был )?ограничен/i,
  /ограничени[яй] (?:будут|будет) сняты?/i,
  /ограничен/i,
];

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  января: 0,
  январь: 0,
  февраля: 1,
  февраль: 1,
  марта: 2,
  март: 2,
  апреля: 3,
  апрель: 3,
  мая: 4,
  май: 4,
  июня: 5,
  июнь: 5,
  июля: 6,
  июль: 6,
  августа: 7,
  август: 7,
  сентября: 8,
  сентябрь: 8,
  октября: 9,
  октябрь: 9,
  ноября: 10,
  ноябрь: 10,
  декабря: 11,
  декабрь: 11,
};

/** "…until 28 May 2026" / "…до 28 мая 2026, 10:00 UTC". */
const DATE = /(\d{1,2})\s+([\p{L}]+)\s+(\d{4})(?:\s*,?\s*(\d{1,2}):(\d{2}))?/iu;

export const parseSpamUntil = (text: string): number | null => {
  const m = DATE.exec(text);
  if (!m) return null;
  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = m;
  const month = MONTHS[(monthRaw ?? '').toLowerCase()];
  if (month === undefined) return null;
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  if (!day || day > 31 || !year) return null;
  return Date.UTC(year, month, day, Number(hourRaw ?? 0), Number(minuteRaw ?? 0));
};

const matches = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((re) => re.test(text));

export const parseSpamReply = (text: string): TelegramSpamVerdict => {
  const body = text.trim();
  if (!body) return { status: 'unknown', until: null };

  // Checked first: a free account's reply also contains the word "limits".
  if (matches(FREE, body)) return { status: 'free', until: null };

  const until = parseSpamUntil(body);
  const restricted = matches(LIMITED, body);
  if (!restricted && until === null) return { status: 'unknown', until: null };

  // `blocked` is reserved for the wording that says waiting will not help.
  const status: TelegramSpamStatus = matches(PERMANENT, body) ? 'blocked' : 'limited';
  return { status, until };
};

/** The keyboard under the bot's answer, in the only terms the verdict needs: whether the bot took its keyboard away. */
export type SpamKeyboard =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'keys'; readonly rows: readonly (readonly string[])[] };

/** The button the bot offers when a block was lifted on appeal and only the geographic restriction is left. */
const APPEAL_BUTTON = 'OK';

/** The verdict the keyboard alone can give, or `null` when its shape is not one of the three we know. */
export const parseSpamKeyboard = (keyboard: SpamKeyboard | null): TelegramSpamVerdict | null => {
  if (!keyboard) return null;
  // No keyboard at all: the bot hides it when there is nothing left to offer.
  if (keyboard.kind === 'hidden') return { status: 'blocked', until: null };

  const rows = keyboard.rows;
  if (rows.length === 2) {
    const second = rows[1]?.[0]?.trim();
    return second === APPEAL_BUTTON
      ? { status: 'geo', until: null }
      : { status: 'free', until: null };
  }
  if (rows.length === 4) return { status: 'blocked', until: null };
  return null;
};

/** The whole answer — keyboard and words — as one verdict. */
export const readSpamAnswer = (
  text: string,
  keyboard: SpamKeyboard | null,
): TelegramSpamVerdict => {
  const words = parseSpamReply(text);
  const keys = parseSpamKeyboard(keyboard);
  if (!keys) return words;
  if (keys.status === 'free' && (words.status === 'limited' || words.status === 'blocked')) {
    return words;
  }
  return keys;
};

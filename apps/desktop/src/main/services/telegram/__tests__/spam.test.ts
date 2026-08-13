import { describe, expect, it } from 'vitest';
import {
  type SpamKeyboard,
  parseSpamKeyboard,
  parseSpamReply,
  parseSpamUntil,
  readSpamAnswer,
} from '../spam';

const FREE_EN =
  'Good news, no limits are currently applied to your account. ' + "You're free as a bird!";

const FREE_RU =
  'Хорошие новости: никаких ограничений на ваш аккаунт не наложено. ' + 'Вы свободны, как птица!';

const LIMITED_EN =
  'I’m very sorry that you had to contact me. Unfortunately, some Telegram ' +
  'features are unavailable to you: your account is limited until 28 May 2026, 10:30 UTC.';

const LIMITED_RU =
  'К сожалению, ваш аккаунт ограничен: некоторые функции Telegram будут ' +
  'недоступны. Ограничения будут сняты 3 июня 2026.';

const BLOCKED_EN =
  'Unfortunately, your account was limited permanently and this will not be lifted.';

const BLOCKED_RU = 'Ваш аккаунт ограничен навсегда, ограничение не будет снято.';

describe('parseSpamReply', () => {
  it('reads a clean account as free, in both languages', () => {
    expect(parseSpamReply(FREE_EN)).toEqual({ status: 'free', until: null });
    expect(parseSpamReply(FREE_RU)).toEqual({ status: 'free', until: null });
  });

  it('does not read "no limits are currently applied" as a limit', () => {
    // The free reply contains the very word the limited reply is matched.
    expect(parseSpamReply(FREE_EN).status).not.toBe('limited');
  });

  it('reads a temporary restriction with the date it lifts', () => {
    expect(parseSpamReply(LIMITED_EN)).toEqual({
      status: 'limited',
      until: Date.UTC(2026, 4, 28, 10, 30),
    });
    expect(parseSpamReply(LIMITED_RU)).toEqual({
      status: 'limited',
      until: Date.UTC(2026, 5, 3, 0, 0),
    });
  });

  it('reserves blocked for the wording that says waiting will not help', () => {
    expect(parseSpamReply(BLOCKED_EN)).toEqual({ status: 'blocked', until: null });
    expect(parseSpamReply(BLOCKED_RU)).toEqual({ status: 'blocked', until: null });
  });

  it('stays limited when a restriction has a date it cannot read', () => {
    // A date format we do not know must not promote the row to a permanent ban.
    const verdict = parseSpamReply('Ваш аккаунт ограничен до 2026-06-03T00:00:00Z.');
    expect(verdict.status).toBe('limited');
    expect(verdict.until).toBeNull();
  });

  it('shrugs rather than guesses on an answer it does not recognise', () => {
    expect(parseSpamReply('Choose an option below.')).toEqual({
      status: 'unknown',
      until: null,
    });
    expect(parseSpamReply('   ')).toEqual({ status: 'unknown', until: null });
  });
});

describe('parseSpamUntil', () => {
  it('reads the day-first, month-in-words form the bot uses', () => {
    expect(parseSpamUntil('until 1 January 2027')).toBe(Date.UTC(2027, 0, 1, 0, 0));
    expect(parseSpamUntil('до 31 декабря 2026, 23:59 UTC')).toBe(Date.UTC(2026, 11, 31, 23, 59));
  });

  it('returns null when there is no date, or the month is not a month', () => {
    expect(parseSpamUntil('no limits are currently applied')).toBeNull();
    expect(parseSpamUntil('12 quatorze 2026')).toBeNull();
  });

  it('rejects an impossible day rather than rolling it into the next month', () => {
    expect(parseSpamUntil('40 May 2026')).toBeNull();
  });
});

const CLEAN_KEYS: SpamKeyboard = {
  kind: 'keys',
  rows: [['What can I do here?'], ['Everything is fine']],
};

const APPEAL_KEYS: SpamKeyboard = {
  kind: 'keys',
  rows: [['What can I do here?'], ['OK']],
};

const BLOCKED_KEYS: SpamKeyboard = {
  kind: 'keys',
  rows: [['Why?'], ['This is a mistake'], ['I will not do it again'], ['Cancel']],
};

describe('parseSpamKeyboard', () => {
  it('reads a hidden keyboard as a block', () => {
    expect(parseSpamKeyboard({ kind: 'hidden' })).toEqual({ status: 'blocked', until: null });
  });

  it('separates a clean account from one left with a geographic restriction', () => {
    // Both wear two rows; the untranslated «OK» in the second is the only thing that tells them apart.
    expect(parseSpamKeyboard(CLEAN_KEYS)).toEqual({ status: 'free', until: null });
    expect(parseSpamKeyboard(APPEAL_KEYS)).toEqual({ status: 'geo', until: null });
  });

  it('reads the four-row appeal keyboard as a block', () => {
    expect(parseSpamKeyboard(BLOCKED_KEYS)).toEqual({ status: 'blocked', until: null });
  });

  it('has no opinion on a shape it does not know, or on no keyboard at all', () => {
    expect(parseSpamKeyboard(null)).toBeNull();
    expect(parseSpamKeyboard({ kind: 'keys', rows: [['Only one row']] })).toBeNull();
  });
});

describe('readSpamAnswer', () => {
  it('reads an account whose language we do not speak', () => {
    // The case this whole path exists for: a Cuban account is answered in Spanish, nothing in the prose matches.
    const spanish =
      'Buenas noticias, no hay limitaciones aplicadas a tu cuenta en este momento. ' +
      '¡Eres libre como un pájaro!';
    expect(parseSpamReply(spanish).status).toBe('unknown');
    expect(readSpamAnswer(spanish, CLEAN_KEYS)).toEqual({ status: 'free', until: null });
  });

  it('lets wording that names a restriction outvote a clean-looking keyboard', () => {
    // The one asymmetry in the file: selling a limited account as free is the expensive mistake.
    expect(readSpamAnswer(LIMITED_EN, CLEAN_KEYS)).toEqual({
      status: 'limited',
      until: Date.UTC(2026, 4, 28, 10, 30),
    });
    expect(readSpamAnswer(BLOCKED_RU, CLEAN_KEYS)).toEqual({ status: 'blocked', until: null });
  });

  it('does not let a shrug overrule the keyboard', () => {
    expect(readSpamAnswer('Choose an option below.', CLEAN_KEYS)).toEqual({
      status: 'free',
      until: null,
    });
    expect(readSpamAnswer('Choose an option below.', BLOCKED_KEYS)).toEqual({
      status: 'blocked',
      until: null,
    });
  });

  it('does not attach a stray date to a state that has none', () => {
    // «Blocked since 3 июня 2026» is not «blocked until»: none of the three keyboard shapes means «until».
    expect(readSpamAnswer('Заблокирован 3 июня 2026.', APPEAL_KEYS)).toEqual({
      status: 'geo',
      until: null,
    });
  });

  it('falls back to the words when there is no keyboard to read', () => {
    expect(readSpamAnswer(LIMITED_RU, null)).toEqual(parseSpamReply(LIMITED_RU));
    expect(readSpamAnswer(FREE_EN, null)).toEqual({ status: 'free', until: null });
  });
});

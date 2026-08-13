type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** The app ships two locales; everything else maps onto the English formats. */
export const intlLocale = (locale: string): string => (locale === 'ru' ? 'ru-RU' : 'en-US');

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

const numberFormat = (key: string, create: () => Intl.NumberFormat): Intl.NumberFormat => {
  const cached = numberFormats.get(key);
  if (cached) return cached;
  const made = create();
  numberFormats.set(key, made);
  return made;
};

const dateFormat = (key: string, create: () => Intl.DateTimeFormat): Intl.DateTimeFormat => {
  const cached = dateFormats.get(key);
  if (cached) return cached;
  const made = create();
  dateFormats.set(key, made);
  return made;
};

export const formatHours = (hours: number, locale: string): string => {
  const lc = intlLocale(locale);
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return numberFormat(
    `hours:${lc}`,
    () => new Intl.NumberFormat(lc, { maximumFractionDigits: 1 }),
  ).format(rounded);
};

/** Plain grouped integer — counts of chats, servers, stars, points. */
export const formatCount = (value: number, locale: string): string => {
  const lc = intlLocale(locale);
  return numberFormat(`count:${lc}`, () => new Intl.NumberFormat(lc)).format(value);
};

export const formatPrice = (value: number, currency: string, locale: string): string => {
  const lc = intlLocale(locale);
  // Show cents only when the amount actually has a fractional part (e.g. USD "$0.49").
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  try {
    return numberFormat(
      `price:${lc}:${currency}:${fractionDigits}`,
      () =>
        new Intl.NumberFormat(lc, {
          style: 'currency',
          currency,
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }),
    ).format(value);
  } catch {
    // An unknown ISO code throws inside `Intl`; the raw pair still informs.
    return `${value} ${currency}`;
  }
};

/** Money the market reports in minor units of the viewer's currency (`steam_converted_balance` and friends). */
export const formatMinorUnits = (minor: number, locale: string): string => {
  const lc = intlLocale(locale);
  return numberFormat(
    `minor:${lc}`,
    () => new Intl.NumberFormat(lc, { maximumFractionDigits: 0 }),
  ).format(Math.round(minor / 100));
};

/** The largest time value ECMAScript admits — ±100 000 000 days around the epoch. */
const MAX_TIME_MS = 8.64e15;

/** Shown in place of a date that cannot be rendered at all. */
const NO_DATE = '—';

/** Whether a unix-seconds value is a date any formatter can print. */
export const isDisplayableDate = (unixSeconds: number): boolean => {
  const ms = unixSeconds * 1000;
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_TIME_MS;
};

/** Whether an account actually *has* this date — the question a badge asks before rendering. */
export const hasDate = (unixSeconds: number | null | undefined): unixSeconds is number =>
  typeof unixSeconds === 'number' && unixSeconds > 0;

/** "5 нояб." — day and month, used wherever the year adds nothing. */
export const formatShortDate = (unixSeconds: number, locale: string): string => {
  if (!isDisplayableDate(unixSeconds)) return NO_DATE;
  const lc = intlLocale(locale);
  return dateFormat(
    `short:${lc}`,
    () => new Intl.DateTimeFormat(lc, { day: 'numeric', month: 'short' }),
  ).format(unixSeconds * 1000);
};

/** "5 нояб. 2024 г." — for anything old enough that the year matters. */
export const formatFullDate = (unixSeconds: number, locale: string): string => {
  if (!isDisplayableDate(unixSeconds)) return NO_DATE;
  const lc = intlLocale(locale);
  return dateFormat(
    `full:${lc}`,
    () => new Intl.DateTimeFormat(lc, { day: 'numeric', month: 'short', year: 'numeric' }),
  ).format(unixSeconds * 1000);
};

export const formatLastSeen = (unixSeconds: number, t: Translate): string => {
  const days = Math.floor((Date.now() - unixSeconds * 1000) / (24 * 60 * 60 * 1000));
  if (days <= 0) return t('inventory.card.steam.lastSeenToday');
  return t('inventory.card.steam.lastSeenDays', { count: days });
};

/** "Куплен N дн./ч./мин. */
export const formatPurchasedAgo = (unixSeconds: number, t: Translate, locale: string): string => {
  const ms = Date.now() - unixSeconds * 1000;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 30) return formatFullDate(unixSeconds, locale);
  if (days >= 1) return t('inventory.card.purchasedDays', { count: days });
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return t('inventory.card.purchasedHours', { count: hours });
  // Minutes matter for locally added accounts.
  const minutes = Math.floor(ms / (60 * 1000));
  if (minutes >= 1) return t('inventory.card.purchasedMinutes', { count: minutes });
  return t('inventory.card.purchasedRecently');
};

const regionNames = new Map<string, Intl.DisplayNames>();

export const countryName = (code: string, locale: string): string => {
  try {
    const lc = locale === 'ru' ? 'ru' : 'en';
    let names = regionNames.get(lc);
    if (!names) {
      names = new Intl.DisplayNames([lc], { type: 'region' });
      regionNames.set(lc, names);
    }
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

/** Days since a unix timestamp; negative timestamps and the future clamp to 0. */
export const daysSince = (unixSeconds: number): number =>
  Math.max(0, Math.floor((Date.now() - unixSeconds * 1000) / (24 * 60 * 60 * 1000)));

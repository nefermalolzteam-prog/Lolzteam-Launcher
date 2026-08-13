import { describe, expect, it } from 'vitest';
import { formatFullDate, formatShortDate, isDisplayableDate } from '../cardFormat';

// Every number here reached a card from the market, not from us.
describe('date formatters survive market data', () => {
  const JAN_5_2024 = 1_704_412_800; // 2024-01-05T00:00:00Z

  it('still formats an ordinary timestamp', () => {
    expect(formatShortDate(JAN_5_2024, 'en')).toBe('Jan 5');
    expect(formatFullDate(JAN_5_2024, 'en')).toBe('Jan 5, 2024');
  });

  it('gives a dash instead of throwing on a value that is not a date', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e13]) {
      expect(formatShortDate(bad, 'en')).toBe('—');
      expect(formatFullDate(bad, 'ru')).toBe('—');
    }
  });

  it('knows where the ECMAScript time range ends', () => {
    // 8.64e15 ms is the last representable instant; one second past it is not.
    expect(isDisplayableDate(8.64e12)).toBe(true);
    expect(isDisplayableDate(-8.64e12)).toBe(true);
    expect(isDisplayableDate(8.64e12 + 1)).toBe(false);
    expect(isDisplayableDate(Number.NaN)).toBe(false);
    expect(isDisplayableDate(0)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { toIsoCountry } from '../country';

describe('toIsoCountry', () => {
  it('resolves the ISO official names the market actually sends', () => {
    // The report that started this: an account whose `steam_country` was "Russian Federation" showed no flag at all.
    expect(toIsoCountry('Russian Federation')).toBe('RU');
    expect(toIsoCountry('Syrian Arab Republic')).toBe('SY');
    expect(toIsoCountry('Viet Nam')).toBe('VN');
    expect(toIsoCountry('Korea, Republic of')).toBe('KR');
    expect(toIsoCountry('Korea, Democratic People’s Republic of')).toBe('KP');
    expect(toIsoCountry('Tanzania, United Republic of')).toBe('TZ');
    expect(toIsoCountry('United States of America')).toBe('US');
  });

  it('still resolves the everyday CLDR names', () => {
    expect(toIsoCountry('Russia')).toBe('RU');
    expect(toIsoCountry('United States')).toBe('US');
    expect(toIsoCountry('South Korea')).toBe('KR');
    expect(toIsoCountry('Vietnam')).toBe('VN');
    expect(toIsoCountry('Czechia')).toBe('CZ');
    // Short and narrow styles, which name some regions differently.
    expect(toIsoCountry('Hong Kong')).toBe('HK');
    expect(toIsoCountry('Hong Kong SAR China')).toBe('HK');
  });

  it('ignores case, punctuation, diacritics and the words the two dialects disagree on', () => {
    expect(toIsoCountry('côte d’ivoire')).toBe('CI');
    expect(toIsoCountry("Cote D'ivoire (Ivory Coast)")).toBe('CI');
    expect(toIsoCountry('Türkiye')).toBe('TR');
    expect(toIsoCountry('Turkey')).toBe('TR');
    expect(toIsoCountry('  UNITED   KINGDOM  ')).toBe('GB');
    // "St." vs "Saint", "&" vs "and", a stray "the".
    expect(toIsoCountry('St. Kitts and Nevis')).toBe('KN');
    expect(toIsoCountry('Saint Vincent & the Grenadines')).toBe('VC');
  });

  it('falls back to the name without its qualifier', () => {
    expect(toIsoCountry('Falkland Islands (Malvinas)')).toBe('FK');
    expect(toIsoCountry('Moldova, Republic of')).toBe('MD');
    expect(toIsoCountry('Bolivia, Plurinational State of')).toBe('BO');
    // …but not when the head names a different country than the whole.
    expect(toIsoCountry('Congo, the Democratic Republic of the')).toBe('CD');
    expect(toIsoCountry('Congo')).toBe('CG');
  });

  it('canonicalises codes ISO has retired', () => {
    // CLDR names SU "Russia" and UK "United Kingdom" as readily as RU and GB; a flag set knows only the live code.
    expect(toIsoCountry('SU')).toBe('RU');
    expect(toIsoCountry('UK')).toBe('GB');
    expect(toIsoCountry('Serbia')).toBe('RS');
    expect(toIsoCountry('Curaçao')).toBe('CW');
  });

  it('passes ISO codes through in any case', () => {
    expect(toIsoCountry('RU')).toBe('RU');
    expect(toIsoCountry('ru')).toBe('RU');
    expect(toIsoCountry('  de  ')).toBe('DE');
  });

  it('returns null instead of a wrong flag', () => {
    expect(toIsoCountry(null)).toBeNull();
    expect(toIsoCountry(undefined)).toBeNull();
    expect(toIsoCountry('')).toBeNull();
    expect(toIsoCountry('   ')).toBeNull();
    expect(toIsoCountry(42)).toBeNull();
    expect(toIsoCountry('Narnia')).toBeNull();
    // Not a country code…
    expect(toIsoCountry('XX')).toBeNull();
    // …and not a country: "Unknown Region" canonicalises to US in ICU.
    expect(toIsoCountry('ZZ')).toBeNull();
    expect(toIsoCountry('EU')).toBeNull();
    // Ambiguous on its own: two Koreas, two sets of Virgin Islands.
    expect(toIsoCountry('Korea')).toBeNull();
    expect(toIsoCountry('Virgin Islands')).toBeNull();
  });

  it('covers every name in Steam’s own country list', () => {
    // A sample of the awkward third of `steamcommunity.com/actions/QueryLocations`.
    const cases: Readonly<Record<string, string>> = {
      'Cocos (Keeling) Islands': 'CC',
      'Czech Republic': 'CZ',
      'Heard & McDonald Islands': 'HM',
      'Islamic Republic of Iran': 'IR',
      'Macedonia, The Former Yugoslav Republic of': 'MK',
      Macau: 'MO',
      Monserrat: 'MS',
      'Palestinian Territory, Occupied': 'PS',
      Pitcairn: 'PN',
      'Saint Martin (French part)': 'MF',
      'Sint Maarten (Dutch part)': 'SX',
      'Svalbard & Jan Mayen Islands': 'SJ',
      Swaziland: 'SZ',
      Laos: 'LA',
      'Brunei Darussalam': 'BN',
      'United Kingdom (Great Britain)': 'GB',
      'United States Minor Outlying': 'UM',
      'United States Virgin Islands': 'VI',
      'British Virgin Islands': 'VG',
      'Vatican City State (Holy See)': 'VA',
      'Wallis & Futuna Islands': 'WF',
      'Bonaire, Sint Eustatius and Saba': 'BQ',
      'Aland Islands': 'AX',
      Kosovo: 'XK',
      'Cape Verde': 'CV',
      Reunion: 'RE',
      'St. Helena': 'SH',
      'St. Pierre & Miquelon': 'PM',
      Micronesia: 'FM',
      Taiwan: 'TW',
    };
    for (const [name, iso] of Object.entries(cases))
      expect([name, toIsoCountry(name)]).toEqual([name, iso]);
  });
});

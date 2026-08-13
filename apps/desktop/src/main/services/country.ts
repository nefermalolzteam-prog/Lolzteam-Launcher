/** CLDR regions that are not countries. */
const AGGREGATES: ReadonlySet<string> = new Set(['EU', 'EZ', 'QO', 'QU', 'UN', 'XA', 'XB', 'ZZ']);

/** All three CLDR styles, because they disagree in useful ways: HK is "Hong Kong SAR China" long and "Hong Kong" short. */
const REGION_LONG = new Intl.DisplayNames(['en'], { type: 'region', style: 'long' });
const REGION_NAMES: readonly Intl.DisplayNames[] = [
  REGION_LONG,
  new Intl.DisplayNames(['en'], { type: 'region', style: 'short' }),
  new Intl.DisplayNames(['en'], { type: 'region', style: 'narrow' }),
];

/** `of` echoes the input back when the code is not a region it knows. */
const isRegion = (code: string): boolean => {
  try {
    return REGION_LONG.of(code) !== code;
  } catch {
    return false;
  }
};

/** The live code for a region code, or `null` if it is not a country. */
const canonicalCode = (code: string): string | null => {
  if (AGGREGATES.has(code) || !isRegion(code)) return null;
  try {
    const region = new Intl.Locale(`und-${code}`).maximize().region;
    return region && /^[A-Z]{2}$/.test(region) ? region : null;
  } catch {
    return null;
  }
};

/** The form both sides of a comparison are reduced to. */
const normalizeName = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[.'’`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => (token === 'st' ? 'saint' : token))
    .filter((token) => token && token !== 'the' && token !== 'and')
    .join(' ');

/** Names CLDR does not produce, in the spelling the sources actually send. */
const ALIASES: Readonly<Record<string, string>> = {
  'Bolivia, Plurinational State of': 'BO',
  'Bonaire, Sint Eustatius and Saba': 'BQ',
  'Brunei Darussalam': 'BN',
  Burma: 'MM',
  Congo: 'CG',
  'Congo, the Democratic Republic of the': 'CD',
  'Democratic Republic of the Congo': 'CD',
  'Republic of the Congo': 'CG',
  "Cote D'ivoire (Ivory Coast)": 'CI',
  'Ivory Coast': 'CI',
  'Czech Republic': 'CZ',
  'East Timor': 'TL',
  'Falkland Islands (Malvinas)': 'FK',
  'Great Britain': 'GB',
  'Heard Island and McDonald Islands': 'HM',
  'Holy See': 'VA',
  'Holy See (Vatican City State)': 'VA',
  'Vatican City State (Holy See)': 'VA',
  'Iran, Islamic Republic of': 'IR',
  'Islamic Republic of Iran': 'IR',
  'Korea, Democratic People’s Republic of': 'KP',
  'Korea, Republic of': 'KR',
  'Republic of Korea': 'KR',
  "Lao People's Democratic Republic": 'LA',
  'Libyan Arab Jamahiriya': 'LY',
  Macau: 'MO',
  Macedonia: 'MK',
  'Macedonia, The Former Yugoslav Republic of': 'MK',
  'Micronesia, Federated States of': 'FM',
  'Moldova, Republic of': 'MD',
  'Republic of Moldova': 'MD',
  Monserrat: 'MS',
  'Palestinian Territory, Occupied': 'PS',
  'State of Palestine': 'PS',
  Pitcairn: 'PN',
  'Russian Federation': 'RU',
  'Saint Martin (French part)': 'MF',
  'Sint Maarten (Dutch part)': 'SX',
  'Svalbard & Jan Mayen Islands': 'SJ',
  Swaziland: 'SZ',
  'Syrian Arab Republic': 'SY',
  'Taiwan, Province of China': 'TW',
  'Tanzania, United Republic of': 'TZ',
  Turkey: 'TR',
  'United Kingdom (Great Britain)': 'GB',
  'United States of America': 'US',
  USA: 'US',
  'United States Minor Outlying': 'UM',
  'United States Minor Outlying Islands': 'UM',
  'United States Virgin Islands': 'VI',
  'Virgin Islands, U.S.': 'VI',
  'Virgin Islands, British': 'VG',
  'Venezuela, Bolivarian Republic of': 'VE',
  'Viet Nam': 'VN',
  'Wallis & Futuna Islands': 'WF',
};

const buildNameToIso = (): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const iso = canonicalCode(code);
      if (!iso) continue;
      for (const names of REGION_NAMES) {
        let name: string | undefined;
        try {
          name = names.of(code);
        } catch {
          name = undefined;
        }
        if (!name || name === code) continue;
        const key = normalizeName(name);
        // First writer wins: the deprecated codes canonicalise to the same ISO code as the live one.
        if (key && !map.has(key)) map.set(key, iso);
      }
    }
  }
  // Aliases are written last on purpose: where a source's spelling collides with a CLDR name.
  for (const [name, iso] of Object.entries(ALIASES)) map.set(normalizeName(name), iso);
  return map;
};

const NAME_TO_ISO = buildNameToIso();

const lookupName = (raw: string): string | null => {
  const direct = NAME_TO_ISO.get(normalizeName(raw));
  if (direct) return direct;

  // "Falkland Islands (Malvinas)" → "Falkland Islands".
  const bare = raw.replace(/\([^)]*\)/g, ' ');
  const withoutQualifier = NAME_TO_ISO.get(normalizeName(bare));
  if (withoutQualifier) return withoutQualifier;

  // "Moldova, Republic of" → "Moldova".
  return NAME_TO_ISO.get(normalizeName(bare.split(',')[0] ?? '')) ?? null;
};

/** ISO alpha-2 country code for an ISO code or an English country name; `null` when it cannot be resolved. */
export const toIsoCountry = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  // A code still goes through `canonicalCode`.
  if (/^[a-z]{2}$/i.test(raw)) return canonicalCode(raw.toUpperCase());
  return lookupName(raw);
};

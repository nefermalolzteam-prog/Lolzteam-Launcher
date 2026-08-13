import type { TFunction } from 'i18next';

/** Main answers mutations with machine-readable codes. */
export const localErrorText = (t: TFunction, code: string): string => {
  const key = `inventory.local.errors.${code}`;
  const translated = t(key);
  return translated === key ? code : translated;
};

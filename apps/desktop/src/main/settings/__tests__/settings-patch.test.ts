import { DEFAULT_SETTINGS, type LauncherSettings } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { sanitizeSettingsPatch } from '../settings-patch';

describe('sanitizeSettingsPatch', () => {
  /** The defaults are the one patch that is guaranteed legal. */
  it('accepts the defaults untouched', () => {
    const { patch, rejected } = sanitizeSettingsPatch(DEFAULT_SETTINGS);
    expect(rejected).toEqual([]);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (value === undefined) continue;
      expect(patch[key as keyof LauncherSettings]).toEqual(value);
    }
  });

  it('drops the malformed key and keeps the rest of the patch', () => {
    const { patch, rejected } = sanitizeSettingsPatch({
      proxies: null,
      proxyEnabled: true,
    });
    expect(rejected).toEqual(['proxies']);
    expect(patch).toEqual({ proxyEnabled: true });
  });

  it('reports keys the settings type has never heard of', () => {
    const { patch, rejected } = sanitizeSettingsPatch({ nonsense: 1, locale: 'en' });
    expect(rejected).toEqual(['nonsense']);
    expect(patch).toEqual({ locale: 'en' });
  });

  it('refuses a proxy list whose entries are not proxies', () => {
    const good = { id: 'a', host: '1.2.3.4', port: 8080 };
    expect(sanitizeSettingsPatch({ proxies: [good] }).rejected).toEqual([]);
    expect(sanitizeSettingsPatch({ proxies: [good, {}] }).rejected).toEqual(['proxies']);
    expect(sanitizeSettingsPatch({ proxies: [{ ...good, port: 0 }] }).rejected).toEqual([
      'proxies',
    ]);
    expect(sanitizeSettingsPatch({ proxies: [{ ...good, port: 70000 }] }).rejected).toEqual([
      'proxies',
    ]);
    expect(sanitizeSettingsPatch({ proxies: [{ ...good, host: '  ' }] }).rejected).toEqual([
      'proxies',
    ]);
    expect(sanitizeSettingsPatch({ proxies: [{ ...good, protocol: 'socks5' }] }).rejected).toEqual([
      'proxies',
    ]);
  });

  it('takes 0 for the counts that use it as «off» or «unlimited»', () => {
    const { patch, rejected } = sanitizeSettingsPatch({
      telegramMaxAccounts: 0,
      backgroundRefreshMinutes: 0,
    });
    expect(rejected).toEqual([]);
    expect(patch).toEqual({ telegramMaxAccounts: 0, backgroundRefreshMinutes: 0 });
  });

  it('refuses counts that are not small whole numbers', () => {
    expect(sanitizeSettingsPatch({ accountLoadConcurrency: -1 }).rejected).toEqual([
      'accountLoadConcurrency',
    ]);
    expect(sanitizeSettingsPatch({ accountLoadConcurrency: 1.5 }).rejected).toEqual([
      'accountLoadConcurrency',
    ]);
    expect(sanitizeSettingsPatch({ accountLoadConcurrency: '2' }).rejected).toEqual([
      'accountLoadConcurrency',
    ]);
    expect(sanitizeSettingsPatch({ accountLoadConcurrency: Number.NaN }).rejected).toEqual([
      'accountLoadConcurrency',
    ]);
  });

  it('keeps enums to their own values', () => {
    expect(sanitizeSettingsPatch({ locale: 'de' }).rejected).toEqual(['locale']);
    expect(sanitizeSettingsPatch({ inventoryLayout: 'list' }).rejected).toEqual([
      'inventoryLayout',
    ]);
    expect(sanitizeSettingsPatch({ proxyServices: ['steam', 'nope'] }).rejected).toEqual([
      'proxyServices',
    ]);
    expect(sanitizeSettingsPatch({ preferredLoginMethod: { steam: 'native' } }).rejected).toEqual(
      [],
    );
    expect(sanitizeSettingsPatch({ preferredLoginMethod: { steam: 'qr' } }).rejected).toEqual([
      'preferredLoginMethod',
    ]);
  });

  it('lets a tri-state through as null but not as anything else', () => {
    expect(sanitizeSettingsPatch({ metricsEnabled: null }).patch).toEqual({ metricsEnabled: null });
    expect(sanitizeSettingsPatch({ metricsEnabled: 1 }).rejected).toEqual(['metricsEnabled']);
  });

  it('validates an inventory filter entry field by field', () => {
    const entry = {
      includeLabels: [1],
      excludeLabels: [],
      attrs: ['a'],
      validity: ['valid'],
      folder: null,
    };
    expect(sanitizeSettingsPatch({ inventoryFilters: { steam: entry } }).rejected).toEqual([]);
    expect(
      sanitizeSettingsPatch({ inventoryFilters: { steam: { ...entry, validity: ['maybe'] } } })
        .rejected,
    ).toEqual(['inventoryFilters']);
    expect(
      sanitizeSettingsPatch({ inventoryFilters: { steam: { ...entry, includeLabels: ['1'] } } })
        .rejected,
    ).toEqual(['inventoryFilters']);
  });

  /** A key set to `undefined` would be written as absent and read back as the default. */
  it('skips undefined without calling it a rejection', () => {
    const { patch, rejected } = sanitizeSettingsPatch({ telegramExePath: undefined });
    expect(rejected).toEqual([]);
    expect(Object.keys(patch)).toEqual([]);
  });

  it('answers an empty patch for something that is not an object at all', () => {
    for (const raw of [null, undefined, 'proxies', 42, ['proxies']]) {
      expect(sanitizeSettingsPatch(raw)).toEqual({ patch: {}, rejected: [] });
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  mergeSidecar,
  parseTelegramSidecarJson,
  serializeTelegramSidecar,
  tdesktopSidecarDefaults,
} from '../session-json';

describe('parseTelegramSidecar', () => {
  it('reads the snake_case spelling a Telethon base uses', () => {
    const meta = parseTelegramSidecarJson(
      JSON.stringify({
        phone: '79001234567',
        user_id: 777000123,
        app_id: 2040,
        app_hash: 'b18441a1ff607e10a989891a5462e627',
        dc_id: 2,
        device: 'Desktop',
        sdk: 'Windows 10',
        app_version: '4.16.8',
        lang_pack: 'tdesktop',
        lang_code: 'en',
        system_lang_pack: 'en-US',
        system_lang_code: 'en-US',
        twoFA: 'hunter2',
        first_name: 'Ivan',
        last_name: 'Petrov',
        username: 'ivanp',
        register_time: 1700000000,
      }),
    );

    expect(meta?.phone).toBe('+79001234567');
    expect(meta?.userId).toBe(777000123);
    expect(meta?.apiId).toBe(2040);
    expect(meta?.apiHash).toBe('b18441a1ff607e10a989891a5462e627');
    expect(meta?.dcId).toBe(2);
    expect(meta?.device).toBe('Desktop');
    expect(meta?.sdk).toBe('Windows 10');
    expect(meta?.appVersion).toBe('4.16.8');
    expect(meta?.langPack).toBe('tdesktop');
    expect(meta?.langCode).toBe('en');
    expect(meta?.systemLangPack).toBe('en-US');
    expect(meta?.systemLangCode).toBe('en-US');
    expect(meta?.twoFa).toBe('hunter2');
    expect(meta?.firstName).toBe('Ivan');
    expect(meta?.lastName).toBe('Petrov');
    expect(meta?.username).toBe('ivanp');
    expect(meta?.registerTime).toBe(1700000000);
  });

  it('reads the camelCase spelling too, and numeric ids given as strings', () => {
    const meta = parseTelegramSidecarJson(
      JSON.stringify({
        telegram_phone: '+7 900 123-45-67',
        userId: '777000123',
        apiId: '2040',
        apiHash: 'deadbeef',
        dcId: '4',
        deviceModel: 'iPhone 14',
        systemVersion: '17.1',
        two_fa: 'secret',
      }),
    );

    expect(meta?.phone).toBe('+79001234567');
    expect(meta?.userId).toBe(777000123);
    expect(meta?.apiId).toBe(2040);
    expect(meta?.dcId).toBe(4);
    expect(meta?.device).toBe('iPhone 14');
    expect(meta?.sdk).toBe('17.1');
    expect(meta?.twoFa).toBe('secret');
  });

  // The whole point of the alias table: `telegram_password` is a 0/1 flag saying "this account has 2FA".
  it('never reads telegram_password as a credential', () => {
    const flagOnly = parseTelegramSidecarJson(
      JSON.stringify({ phone: '79001234567', telegram_password: 1 }),
    );
    expect(flagOnly?.twoFa).toBeNull();

    const withValue = parseTelegramSidecarJson(
      JSON.stringify({ telegram_password: 1, telegram_password_value: 'hunter2' }),
    );
    expect(withValue?.twoFa).toBe('hunter2');

    // Some exporters put the flag in `password` instead; a bare "1" is not a password.
    expect(parseTelegramSidecarJson(JSON.stringify({ password: '1' }))?.twoFa).toBeNull();
    expect(parseTelegramSidecarJson(JSON.stringify({ password: '0' }))?.twoFa).toBeNull();
    expect(parseTelegramSidecarJson(JSON.stringify({ password: 'qwerty' }))?.twoFa).toBe('qwerty');
  });

  it('carries the telegram_password flag back out untouched', () => {
    // Not read, but not dropped either — the two halves of the same decision.
    const meta = parseTelegramSidecarJson(
      JSON.stringify({ phone: '79001234567', telegram_password: 1 }),
    );
    expect(meta?.extra).toEqual({ telegram_password: 1 });

    const written = JSON.parse(serializeTelegramSidecar(meta!, 'acc.session'));
    expect(written.telegram_password).toBe(1);
    // And it is still not a credential on the way out: `twoFA` is absent.
    expect(written.twoFA).toBeUndefined();
  });

  it('keeps unrecognised keys so a round trip loses nothing', () => {
    const meta = parseTelegramSidecarJson(
      JSON.stringify({ phone: '79001234567', proxy: '1.2.3.4:8080', avatar: true }),
    );
    expect(meta?.extra).toEqual({ proxy: '1.2.3.4:8080', avatar: true });

    const written = JSON.parse(serializeTelegramSidecar(meta!, 'acc.session'));
    expect(written.proxy).toBe('1.2.3.4:8080');
    expect(written.avatar).toBe(true);
    expect(written.session_file).toBe('acc.session');
    expect(written.phone).toBe('+79001234567');
  });

  it('omits absent fields rather than writing them as null', () => {
    const written = JSON.parse(
      serializeTelegramSidecar(parseTelegramSidecarJson(JSON.stringify({ phone: '79001' }))!),
    );
    expect(Object.keys(written)).toEqual(['phone']);
  });

  it('rejects anything that is not a json object', () => {
    expect(parseTelegramSidecarJson('not json')).toBeNull();
    expect(parseTelegramSidecarJson('[1,2,3]')).toBeNull();
    expect(parseTelegramSidecarJson('null')).toBeNull();
  });
});

/** The pack is the translation bundle (`tdesktop`), the code is the language (`en`). */
describe('language fields', () => {
  it('does not turn a lone lang_code into a lang_pack', () => {
    const meta = parseTelegramSidecarJson(JSON.stringify({ lang_code: 'en' }));
    expect(meta?.langCode).toBe('en');
    expect(meta?.langPack).toBeNull();

    const written = JSON.parse(serializeTelegramSidecar(meta!));
    expect(written.lang_code).toBe('en');
    expect(written).not.toHaveProperty('lang_pack');
  });

  it('does not turn a lone lang_pack into a lang_code', () => {
    const meta = parseTelegramSidecarJson(JSON.stringify({ lang_pack: 'tdesktop' }));
    expect(meta?.langPack).toBe('tdesktop');
    expect(meta?.langCode).toBeNull();

    const written = JSON.parse(serializeTelegramSidecar(meta!));
    expect(written.lang_pack).toBe('tdesktop');
    expect(written).not.toHaveProperty('lang_code');
  });

  // The system side of the pair is independent of the client side, both ways.
  it('keeps the system pair separate from the client pair', () => {
    const meta = parseTelegramSidecarJson(
      JSON.stringify({ system_lang_code: 'ru', lang_pack: 'tdesktop' }),
    );
    expect(meta?.systemLangCode).toBe('ru');
    expect(meta?.systemLangPack).toBeNull();
    expect(meta?.langCode).toBeNull();
    expect(meta?.langPack).toBe('tdesktop');
  });
});

/** The market checker reads `id`; most base tooling writes `user_id`. */
describe('user id spellings', () => {
  it('reads either spelling and writes both', () => {
    for (const key of ['id', 'user_id']) {
      const meta = parseTelegramSidecarJson(JSON.stringify({ [key]: 777000123 }));
      expect(meta?.userId).toBe(777000123);

      const written = JSON.parse(serializeTelegramSidecar(meta!));
      expect(written.id).toBe(777000123);
      expect(written.user_id).toBe(777000123);
    }
  });

  // Neither spelling may leak into `extra`, or the writer would emit a stale copy.
  it('does not leave the id among the unrecognised keys', () => {
    const meta = parseTelegramSidecarJson(JSON.stringify({ id: 1, user_id: 2 }));
    expect(meta?.extra).toEqual({});
  });
});

/** The converter writes a sidecar for every account it produces. */
describe('round trip', () => {
  it('loses no key on parse -> serialize -> parse', () => {
    const source = {
      app_id: 2040,
      app_hash: 'b18441a1ff607e10a989891a5462e627',
      device: 'AB12CD-PRO',
      sdk: 'Windows 10',
      app_version: '7.0.5 x64',
      system_lang_pack: 'en',
      system_lang_code: 'en',
      lang_pack: 'tdesktop',
      lang_code: 'en',
      twoFA: 'hunter2',
      role: 'buyer',
      id: 777000123,
      user_id: 777000123,
      phone: '+79001234567',
      username: 'ivanp',
      date_of_birth: '1990-01-01',
      date_of_birth_integrity: 'verified',
      is_premium: true,
      has_profile_pic: true,
      spamblock: 'free',
      register_time: 1700000000,
      last_check_time: 1750000000,
      avatar: 'photo.jpg',
      first_name: 'Ivan',
      last_name: 'Petrov',
      sex: 1,
      proxy: '1.2.3.4:8080',
      ipv6: false,
      dc_id: 2,
    };

    const once = parseTelegramSidecarJson(JSON.stringify(source));
    const written = JSON.parse(serializeTelegramSidecar(once!));
    expect(written).toMatchObject(source);

    // And a second pass changes nothing, which is what "stable" actually means.
    const twice = parseTelegramSidecarJson(JSON.stringify(written));
    expect(twice).toEqual(once);
  });

  // `false` and `0` are meaningful answers from a checker; only absence is not.
  it('keeps falsy unrecognised values instead of dropping them', () => {
    const meta = parseTelegramSidecarJson(JSON.stringify({ is_premium: false, spamblock: 0 }));
    const written = JSON.parse(serializeTelegramSidecar(meta!));
    expect(written.is_premium).toBe(false);
    expect(written.spamblock).toBe(0);
  });
});

/** Synthesised sidecars exist so the checker has something to connect with. */
describe('tdesktopSidecarDefaults', () => {
  it('matches the client config the market checker defaults to', () => {
    const defaults = tdesktopSidecarDefaults();
    expect(defaults.apiId).toBe(2040);
    expect(defaults.apiHash).toBe('b18441a1ff607e10a989891a5462e627');
    expect(defaults.sdk).toBe('Windows 10');
    expect(defaults.appVersion).toBe('7.0.5 x64');
    expect(defaults.langPack).toBe('tdesktop');
    expect(defaults.langCode).toBe('en');
    expect(defaults.systemLangPack).toBe('en');
    expect(defaults.systemLangCode).toBe('en');
    expect(defaults.registerTime).toBeNull();
    expect(defaults.phone).toBeNull();
    expect(defaults.twoFa).toBeNull();
  });

  it('invents a device string shaped like theirs, fresh each time', () => {
    const model = tdesktopSidecarDefaults().device;
    expect(model).toMatch(/^[A-Z0-9]{4,10}-(PRO|EXTREME|ELITE|PREMIUM)$/);

    const many = new Set(Array.from({ length: 32 }, () => tdesktopSidecarDefaults().device));
    expect(many.size).toBeGreaterThan(1);
  });

  it('only fills gaps when merged over a real file', () => {
    const base = parseTelegramSidecarJson(
      JSON.stringify({ app_id: 17349, device: 'iPhone 14', lang_code: 'ru' }),
    );
    const merged = mergeSidecar(base, tdesktopSidecarDefaults());
    expect(merged.apiId).toBe(17349);
    expect(merged.device).toBe('iPhone 14');
    expect(merged.langCode).toBe('ru');
    expect(merged.langPack).toBe('tdesktop');
  });

  it('never lends tdesktop credentials to a file that named its own app', () => {
    // The pairing is the whole point: 17349 with tdesktop's hash is an application that does not exist.
    const base = parseTelegramSidecarJson(JSON.stringify({ app_id: 17349 }));
    const merged = mergeSidecar(base, tdesktopSidecarDefaults());
    expect(merged.apiId).toBe(17349);
    expect(merged.apiHash).toBeNull();

    // Same rule read from the other side: a file with neither half takes both.
    const bare = mergeSidecar(parseTelegramSidecarJson('{}'), tdesktopSidecarDefaults());
    expect(bare.apiId).toBe(2040);
    expect(bare.apiHash).toBe('b18441a1ff607e10a989891a5462e627');
  });

  it('keeps the client fingerprint whole rather than assembling it from three sources', () => {
    const base = parseTelegramSidecarJson(JSON.stringify({ device: 'iPhone 14' }));
    const merged = mergeSidecar(base, tdesktopSidecarDefaults());
    expect(merged.device).toBe('iPhone 14');
    expect(merged.sdk).toBeNull();
    expect(merged.appVersion).toBeNull();
  });
});

describe('mergeSidecar', () => {
  it('fills gaps without overwriting what is already known', () => {
    const base = parseTelegramSidecarJson(JSON.stringify({ phone: '79001234567' }));
    const merged = mergeSidecar(base, { userId: 555, phone: '+70000000000', apiId: 2040 });
    expect(merged.phone).toBe('+79001234567');
    expect(merged.userId).toBe(555);
    expect(merged.apiId).toBe(2040);
  });

  it('treats a missing base as an empty one', () => {
    const merged = mergeSidecar(null, { userId: 555 });
    expect(merged.userId).toBe(555);
    expect(merged.phone).toBeNull();
  });
});

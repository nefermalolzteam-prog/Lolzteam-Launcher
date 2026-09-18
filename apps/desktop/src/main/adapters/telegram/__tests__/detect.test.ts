import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectTelegramBinary, looksLikeFlatpakTelegram, looksLikeSwiftTelegram } from '../detect';

const fsWith = (...present: string[]) => {
  const set = new Set(present);
  return (path: string) => set.has(path);
};

describe('detectTelegramBinary', () => {
  it('finds a distribution package', () => {
    expect(detectTelegramBinary('linux', '/home/u', fsWith('/usr/bin/Telegram'))).toBe(
      '/usr/bin/Telegram',
    );
  });

  it('prefers the distribution package over a hand-unpacked copy', () => {
    expect(
      detectTelegramBinary(
        'linux',
        '/home/u',
        fsWith('/usr/bin/telegram-desktop', '/home/u/Telegram/Telegram'),
      ),
    ).toBe('/usr/bin/telegram-desktop');
  });

  it('finds an unpacked tarball in the home directory', () => {
    expect(detectTelegramBinary('linux', '/home/u', fsWith('/home/u/Telegram/Telegram'))).toBe(
      '/home/u/Telegram/Telegram',
    );
  });

  it('reports nothing when Telegram is not installed', () => {
    expect(detectTelegramBinary('linux', '/home/u', fsWith())).toBeNull();
  });

  it('never guesses on Windows, where a portable copy is required', () => {
    expect(detectTelegramBinary('win32', 'C:\\Users\\u', fsWith('/usr/bin/Telegram'))).toBeNull();
  });
});

describe('detectTelegramBinary on macOS', () => {
  const HOME = '/Users/u';
  const QT_APP = '/Applications/Telegram Desktop.app/Contents/MacOS/Telegram';

  it('finds the Qt Telegram Desktop bundle', () => {
    expect(detectTelegramBinary('darwin', HOME, fsWith(QT_APP))).toBe(QT_APP);
  });

  it('falls back to a user-local bundle in ~/Applications', () => {
    const userApp = `${HOME}/Applications/Telegram Desktop.app/Contents/MacOS/Telegram`;
    expect(detectTelegramBinary('darwin', HOME, fsWith(userApp))).toBe(userApp);
  });

  it('never autodetects the Swift Telegram.app, which cannot read our tdata', () => {
    expect(
      detectTelegramBinary(
        'darwin',
        HOME,
        fsWith('/Applications/Telegram.app/Contents/MacOS/Telegram'),
      ),
    ).toBeNull();
  });

  it('reports nothing when no client is installed', () => {
    expect(detectTelegramBinary('darwin', HOME, fsWith())).toBeNull();
  });
});

describe('looksLikeSwiftTelegram', () => {
  it('recognises the Swift bundle but not the Qt one', () => {
    expect(looksLikeSwiftTelegram('/Applications/Telegram.app/Contents/MacOS/Telegram')).toBe(true);
    expect(
      looksLikeSwiftTelegram('/Users/u/Applications/Telegram.app/Contents/MacOS/Telegram'),
    ).toBe(true);
    expect(
      looksLikeSwiftTelegram('/Applications/Telegram Desktop.app/Contents/MacOS/Telegram'),
    ).toBe(false);
    expect(looksLikeSwiftTelegram('/usr/bin/telegram-desktop')).toBe(false);
  });
});

describe('looksLikeFlatpakTelegram', () => {
  it('recognises the exported wrapper by its location', async () => {
    expect(
      await looksLikeFlatpakTelegram('/var/lib/flatpak/exports/bin/org.telegram.desktop'),
    ).toBe(true);
    expect(
      await looksLikeFlatpakTelegram(
        '/home/u/.local/share/flatpak/exports/bin/org.telegram.desktop',
      ),
    ).toBe(true);
    expect(await looksLikeFlatpakTelegram('/opt/whatever/org.telegram.desktop')).toBe(true);
  });

  it('recognises a hand-written wrapper script that runs flatpak', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lolz-tg-detect-'));
    try {
      const wrapper = join(dir, 'telegram');
      await fs.writeFile(wrapper, '#!/bin/sh\nexec flatpak run org.telegram.desktop "$@"\n');
      expect(await looksLikeFlatpakTelegram(wrapper)).toBe(true);

      const plain = join(dir, 'Telegram');
      await fs.writeFile(plain, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]));
      expect(await looksLikeFlatpakTelegram(plain)).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('answers false for a path it cannot read', async () => {
    expect(await looksLikeFlatpakTelegram('/definitely/not/here')).toBe(false);
  });
});

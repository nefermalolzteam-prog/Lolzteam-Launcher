import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { launchTelegram, resolveTelegramTarget } from '../launch';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'lolz-tg-launch-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('resolveTelegramTarget on Linux', () => {
  it('drives the packaged client with -workdir instead of touching the install', async () => {
    const userData = join(root, 'userData');
    const target = await resolveTelegramTarget('/usr/bin/Telegram', userData, 'linux');

    expect(target.exe).toBe('/usr/bin/Telegram');
    expect(target.workdir).toBe(join(userData, 'telegram'));
    expect(target.args).toEqual(['-workdir', join(userData, 'telegram')]);
    expect(target.tdataDir).toBe(join(userData, 'telegram', 'tdata'));
    // The install directory is read-only on a normal Linux system, and we never
    // need to write to it — that is the whole point of -workdir.
    expect(target.needsPortableMarker).toBe(false);
  });

  it('creates the workdir, owner-only', async () => {
    const userData = join(root, 'userData');
    const target = await resolveTelegramTarget('/usr/bin/Telegram', userData, 'linux');

    const stat = await fs.stat(target.workdir);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it('is idempotent across logins', async () => {
    const userData = join(root, 'userData');
    const first = await resolveTelegramTarget('/usr/bin/Telegram', userData, 'linux');
    await fs.writeFile(join(first.workdir, 'marker'), 'x', 'utf8');
    const second = await resolveTelegramTarget('/usr/bin/Telegram', userData, 'linux');

    expect(second.workdir).toBe(first.workdir);
    expect(await fs.readFile(join(second.workdir, 'marker'), 'utf8')).toBe('x');
  });
});

describe('resolveTelegramTarget on Windows', () => {
  it('keeps the portable layout: tdata beside the exe, marker required', async () => {
    const portable = join(root, 'TelegramPortable');
    await fs.mkdir(portable, { recursive: true });
    const exe = join(portable, 'Telegram.exe');

    const target = await resolveTelegramTarget(exe, join(root, 'userData'), 'win32');
    expect(target.args).toEqual([]);
    expect(target.workdir).toBe(portable);
    expect(target.tdataDir).toBe(join(portable, 'tdata'));
    expect(target.needsPortableMarker).toBe(true);
  });

  it('still refuses an exe sitting at a filesystem root', async () => {
    await expect(
      resolveTelegramTarget('/Telegram.exe', join(root, 'userData'), 'win32'),
    ).rejects.toThrow(/drive root/);
  });
});

describe('resolveTelegramTarget on macOS', () => {
  it('drives the bundled client with -workdir, like on Linux', async () => {
    const exe = '/Applications/Telegram Desktop.app/Contents/MacOS/Telegram';
    const userData = join(root, 'userData');
    const target = await resolveTelegramTarget(exe, userData, 'darwin');

    expect(target.args).toEqual(['-workdir', join(userData, 'telegram')]);
    expect(target.tdataDir).toBe(join(userData, 'telegram', 'tdata'));
    // The .app bundle is root-owned in /Applications; we never write to it.
    expect(target.needsPortableMarker).toBe(false);
  });
});

describe('launchTelegram', () => {
  it('refuses a binary that cannot be executed instead of crashing later', async () => {
    const notExecutable = join(root, 'Telegram');
    await fs.writeFile(notExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    const target = {
      exe: notExecutable,
      args: [],
      workdir: root,
      tdataDir: join(root, 'tdata'),
      needsPortableMarker: false,
    };
    await expect(launchTelegram(target)).rejects.toThrow();
  });

  it('refuses a path that does not exist', async () => {
    const target = {
      exe: join(root, 'nope'),
      args: [],
      workdir: root,
      tdataDir: join(root, 'tdata'),
      needsPortableMarker: false,
    };
    await expect(launchTelegram(target)).rejects.toThrow();
  });
});

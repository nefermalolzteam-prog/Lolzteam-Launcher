import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// On Windows the user points us at a *portable* Telegram.exe, because the
// portable layout is the only way to give the client a tdata of our choosing.
// Linux and macOS have no such convention: Telegram Desktop is a normal
// package in a read-only prefix, and `-workdir` gives us the same control
// without one. So when the setting is empty we can simply find the installed
// client ourselves.
//
// Flatpak (`org.telegram.desktop`) is deliberately not listed: its sandbox
// cannot see a workdir under our userData without a filesystem grant the user
// would have to add by hand, so silently picking it would fail confusingly.
//
// On macOS two different apps answer to "Telegram": "Telegram Desktop.app" —
// the same Qt client as on Linux, tdata-compatible — and "Telegram.app", the
// Swift client from the App Store, which keeps its accounts in its own format
// and would ignore the tdata we write. Only the Qt one is detected; the Swift
// one is recognised and refused with a reason when picked by hand.

const LINUX_CANDIDATES = (home: string): string[] => [
  '/usr/bin/telegram-desktop',
  '/usr/bin/Telegram',
  '/usr/local/bin/telegram-desktop',
  '/usr/local/bin/Telegram',
  '/opt/Telegram/Telegram',
  '/opt/telegram-desktop/Telegram',
  join(home, '.local', 'share', 'TelegramDesktop', 'Telegram'),
  join(home, 'Telegram', 'Telegram'),
];

const DARWIN_CANDIDATES = (home: string): string[] => [
  '/Applications/Telegram Desktop.app/Contents/MacOS/Telegram',
  join(home, 'Applications', 'Telegram Desktop.app', 'Contents', 'MacOS', 'Telegram'),
];

export const detectTelegramBinary = (
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): string | null => {
  if (platform === 'linux') return LINUX_CANDIDATES(home).find(exists) ?? null;
  if (platform === 'darwin') return DARWIN_CANDIDATES(home).find(exists) ?? null;
  return null;
};

/** The configured path if set, otherwise whatever we can find on this platform. */
export const resolveTelegramBinary = (configured: string | null | undefined): string | null => {
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  return detectTelegramBinary();
};

// A Flatpak Telegram (`org.telegram.desktop`) runs in a sandbox that cannot see
// a workdir under our userData, so it would start on the phone-entry screen as
// if the session write had silently failed. Recognise the exported wrapper by
// where it lives and by what it does, and refuse it with a reason instead.
const FLATPAK_EXPORT_DIRS = ['/var/lib/flatpak/exports/bin/', '/.local/share/flatpak/exports/bin/'];

export const looksLikeFlatpakTelegram = async (path: string): Promise<boolean> => {
  if (FLATPAK_EXPORT_DIRS.some((dir) => path.includes(dir))) return true;
  if (path.endsWith('/org.telegram.desktop')) return true;
  // A hand-written wrapper script: small, text, calls `flatpak run`.
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, 'r');
    const { size } = await handle.stat();
    if (size > 4096) return false;
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(size), 0, size, 0);
    const head = buffer.subarray(0, bytesRead).toString('utf8');
    return head.startsWith('#!') && /flatpak\s+run\b/.test(head);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
};

// The Swift "Telegram for macOS" (Telegram.app from the App Store) keeps
// accounts in its own storage format, not tdata, so the session we write
// would be silently ignored and the client would land on the phone-entry
// screen. Recognise it by its bundle name — "Telegram Desktop.app" is the
// Qt client and does not match.
export const looksLikeSwiftTelegram = (path: string): boolean =>
  /\/Telegram\.app\/Contents\/MacOS\//.test(path);

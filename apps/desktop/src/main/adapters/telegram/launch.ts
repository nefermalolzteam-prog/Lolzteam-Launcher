import { type ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cleanSpawnEnv } from '../../lib/spawn-env';
import { getTdataDir } from './paths';

// Where a login writes its session, and how the client is told to read it back.
//
// Windows uses the portable layout: an empty `tportable.tdat` next to the exe
// makes Telegram Desktop read `tdata/` from its own directory. That requires a
// writable install folder, which only a portable copy has.
//
// Linux and macOS have `-workdir`, which does the same job explicitly and
// without touching the installation at all — so the session lives under our
// userData and the packaged system client can stay exactly where the
// distribution put it.

export interface TelegramTarget {
  exe: string;
  /** Extra argv handed to the client on launch. */
  args: readonly string[];
  /** The data root Telegram Desktop works from; `tdata/` sits inside it. */
  workdir: string;
  tdataDir: string;
  /** Whether `tportable.tdat` has to exist beside the exe. */
  needsPortableMarker: boolean;
}

export const resolveTelegramTarget = async (
  exe: string,
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<TelegramTarget> => {
  if (platform === 'win32') {
    const tdataDir = await getTdataDir(exe);
    return {
      exe,
      args: [],
      workdir: dirname(exe),
      tdataDir,
      needsPortableMarker: true,
    };
  }

  const workdir = join(userDataDir, 'telegram');
  await mkdir(workdir, { recursive: true, mode: 0o700 });
  return {
    exe,
    args: ['-workdir', workdir],
    workdir,
    tdataDir: join(workdir, 'tdata'),
    needsPortableMarker: false,
  };
};

type Logger = { warn: (msg: string, err?: unknown) => void };

/**
 * Starts the client detached from us. Rejects if the binary cannot be executed
 * — a directory, a file without the execute bit, a path that vanished since
 * probe — so the caller can report that instead of the main process dying on
 * an unhandled 'error' event after login already claimed success.
 */
export const launchTelegram = async (
  target: TelegramTarget,
  log?: Logger,
): Promise<ChildProcess> => {
  await access(target.exe, constants.X_OK);
  const child = spawn(target.exe, [...target.args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    // A packaged client started from our AppImage would otherwise inherit the
    // bundle's Qt and GTK module paths and fail before showing a window.
    env: cleanSpawnEnv(),
  });
  child.on('error', (err) => log?.warn('[telegram] client failed to start', err));
  child.unref();
  return child;
};

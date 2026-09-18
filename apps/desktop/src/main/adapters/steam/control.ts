import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { sep } from 'node:path';
import { promisify } from 'node:util';
import { cleanSpawnEnv } from '../../lib/spawn-env';
import { findDarwinPids } from '../_shared/proc-darwin';
import { findLinuxPids, signalPids, waitUntilGone } from '../_shared/proc-linux';
import type { SteamInstall } from './paths';
import { killSteamProcesses, waitForSteamExit } from './process';

const execFileAsync = promisify(execFile);

const FLATPAK_APP = 'com.valvesoftware.Steam';

type Logger = { info: (msg: string) => void; warn: (msg: string, err?: unknown) => void };

// ─── Linux ──────────────────────────────────────────────────────────────────

// Everything the *client* runs — the main binary, steamwebhelper, the error
// reporter, the pressure-vessel sandbox around the web helper — lives under
// the data root: `ubuntu12_32/`, `ubuntu12_64/`, `steamrt*/`. Games, Proton and
// the Steam Linux Runtime live there too, under `steamapps/` and
// `compatibilitytools.d/`, and must be left alone: a game that outlives
// `-shutdown` is the player's business, not a reason to SIGKILL it. macOS
// spells its library folder `SteamApps`, so both spellings are excluded.
const NOT_CLIENT_DIRS = ['steamapps', 'SteamApps', 'compatibilitytools.d'];

export const isSteamClientExe = (exe: string | null, steamDir: string): boolean => {
  if (!exe) return false;
  const root = steamDir.endsWith(sep) ? steamDir : steamDir + sep;
  if (!exe.startsWith(root)) return false;
  const rel = exe.slice(root.length);
  return !NOT_CLIENT_DIRS.some((dir) => rel === dir || rel.startsWith(dir + sep));
};

const linuxClientPids = (steamDir: string): Promise<number[]> =>
  findLinuxPids((proc) => isSteamClientExe(proc.exe, steamDir));

// ─── macOS ──────────────────────────────────────────────────────────────────

/** `…/Steam.app/Contents/MacOS/Steam` → `…/Steam.app`, or null outside a bundle. */
export const darwinAppBundleRoot = (command: string): string | null => {
  const idx = command.lastIndexOf('.app/');
  return idx === -1 ? null : command.slice(0, idx + 4);
};

// On macOS the client binary lives inside the Steam.app bundle, its helpers
// (steamwebhelper and friends) in `Steam.app/Contents/Frameworks`, and the
// update payload under the data root. argv[0] opens each command line, so a
// plain prefix match on it is exact — spaces in "Steam Helper.app" included.
const darwinClientPids = (steamDir: string, appBundle: string | null): Promise<number[]> =>
  findDarwinPids((proc) => {
    const roots = appBundle ? [steamDir, appBundle] : [steamDir];
    return roots.some((root) => isSteamClientExe(proc.command, root));
  });

// ─── POSIX (Linux, macOS) ───────────────────────────────────────────────────

const flatpakRunning = async (): Promise<boolean> => {
  try {
    const { stdout } = await execFileAsync('flatpak', ['ps', '--columns=application']);
    return stdout.split('\n').some((line) => line.trim() === FLATPAK_APP);
  } catch {
    return false;
  }
};

const flatpakKill = async (): Promise<void> => {
  await execFileAsync('flatpak', ['kill', FLATPAK_APP]).catch(() => {});
};

const requestShutdown = (install: SteamInstall, log: Logger): void => {
  const asker = spawn(install.launcher.command, [...install.launcher.args, '-shutdown'], {
    detached: true,
    stdio: 'ignore',
    env: cleanSpawnEnv(),
  });
  asker.on('error', (err) => log.warn('[steam] could not run the launcher for -shutdown', err));
  asker.unref();
};

/** The moving parts of a POSIX shutdown, replaceable so the ordering can be tested without a Steam. */
export interface SteamControlDeps {
  clientPids: (steamDir: string) => Promise<number[]>;
  signal: (pids: readonly number[], signal: NodeJS.Signals) => void;
  requestShutdown: (install: SteamInstall, log: Logger) => void;
  flatpakRunning: () => Promise<boolean>;
  flatpakKill: () => Promise<void>;
  /** How long to give SIGTERM, then SIGKILL, before giving up. */
  killGraceMs: { term: number; kill: number };
}

const defaultDeps: SteamControlDeps = {
  clientPids: linuxClientPids,
  signal: signalPids,
  requestShutdown,
  flatpakRunning,
  flatpakKill,
  killGraceMs: { term: 5000, kill: 3000 },
};

// macOS finds its client processes by bundle path rather than /proc, so it
// swaps in its own pid lookup and keeps everything else about the flow.
const depsFor = (install: SteamInstall): SteamControlDeps =>
  install.layout.flavor === 'darwin'
    ? {
        ...defaultDeps,
        clientPids: (steamDir) =>
          darwinClientPids(steamDir, darwinAppBundleRoot(install.launcher.command)),
      }
    : defaultDeps;

const shutdownPosix = async (
  install: SteamInstall,
  log: Logger,
  timeoutMs: number,
  deps: SteamControlDeps,
): Promise<boolean> => {
  const flatpak = install.layout.flavor === 'linux-flatpak';
  const steamDir = install.layout.steamDir;
  const running = flatpak
    ? deps.flatpakRunning
    : async () => (await deps.clientPids(steamDir)).length > 0;

  if (!(await running())) return true;

  // `-shutdown` is the only clean stop: the client flushes `registry.vdf` and
  // `loginusers.vdf` on its way out. Killing it instead would make it rewrite —
  // or worse, not write — the very files we are about to edit.
  log.info('[steam] requesting graceful shutdown');
  deps.requestShutdown(install, log);

  if (await waitUntilGone(running, timeoutMs)) return true;

  if (flatpak) {
    log.warn('[steam] graceful shutdown timed out, asking flatpak to kill the app');
    await deps.flatpakKill();
    return waitUntilGone(running, deps.killGraceMs.term);
  }

  log.warn('[steam] graceful shutdown timed out, sending SIGTERM');
  deps.signal(await deps.clientPids(steamDir), 'SIGTERM');
  if (await waitUntilGone(running, deps.killGraceMs.term)) return true;

  log.warn('[steam] SIGTERM ignored, sending SIGKILL');
  deps.signal(await deps.clientPids(steamDir), 'SIGKILL');
  return waitUntilGone(running, deps.killGraceMs.kill);
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Stops Steam and resolves true once no client process is left from the install.
 *
 * The caller must treat `false` as fatal: a client still holding its config in
 * memory overwrites `registry.vdf` and `loginusers.vdf` when it finally exits,
 * silently undoing the session we are about to write.
 */
export const shutdownSteam = async (
  install: SteamInstall,
  log: Logger,
  timeoutMs = 20_000,
  deps: SteamControlDeps = depsFor(install),
): Promise<boolean> => {
  if (install.layout.flavor === 'win32') {
    await killSteamProcesses();
    await waitForSteamExit(5000);
    return true;
  }
  return shutdownPosix(install, log, timeoutMs, deps);
};

/** Starts Steam, optionally handing it a `steam://` target. Detached from us. */
export const launchSteam = (
  install: SteamInstall,
  target: string | null,
  log?: Logger,
): ChildProcess => {
  const args = [...install.launcher.args, ...(target ? [target] : [])];
  const child = spawn(install.launcher.command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    // Steam re-execs into its own runtime and refuses to start under the
    // loader environment an AppImage parent hands down.
    env: cleanSpawnEnv(),
  });
  // Without a listener a missing or non-executable launcher becomes an
  // uncaught exception in the main process, long after login reported success.
  child.on('error', (err) => log?.warn('[steam] launcher failed to start', err));
  child.unref();
  return child;
};

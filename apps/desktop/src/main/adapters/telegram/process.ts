import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { findDarwinPids, hasWorkdirFlag } from '../_shared/proc-darwin';
import { findLinuxPids, signalPids, waitUntilGone } from '../_shared/proc-linux';
import type { TelegramTarget } from './launch';

const execFileAsync = promisify(execFile);

const PS_FIND_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$name = $env:LZT_PROCESS_NAME -replace "'", "''"
Get-CimInstance Win32_Process -Filter "Name='$name'" |
  ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }
`;

const encodeForPowerShell = (script: string): string =>
  Buffer.from(script, 'utf16le').toString('base64');

const findWindowsPidsByPath = async (exePath: string): Promise<number[]> => {
  const target = exePath.replace(/\//g, '\\').toLowerCase();
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodeForPowerShell(PS_FIND_SCRIPT)],
      {
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, LZT_PROCESS_NAME: basename(exePath) },
      },
    );
    const pids: number[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const sep = line.indexOf('|');
      if (sep === -1) continue;
      const pid = Number(line.slice(0, sep).trim());
      const path = line
        .slice(sep + 1)
        .trim()
        .replace(/\//g, '\\')
        .toLowerCase();
      if (Number.isInteger(pid) && pid > 0 && path === target) pids.push(pid);
    }
    return pids;
  } catch {
    return [];
  }
};

const trimSlashes = (path: string): string => path.replace(/\/+$/, '');

export const isOurTelegramInstance = (argv: readonly string[], workdir: string): boolean => {
  const wanted = trimSlashes(workdir);
  return argv.some(
    (arg, i) => arg === '-workdir' && i + 1 < argv.length && trimSlashes(argv[i + 1]!) === wanted,
  );
};

const findLinuxTelegramPids = (workdir: string): Promise<number[]> =>
  findLinuxPids((proc) => proc.pid !== process.pid && isOurTelegramInstance(proc.argv, workdir));

const findDarwinTelegramPids = (workdir: string): Promise<number[]> =>
  findDarwinPids((proc) => hasWorkdirFlag(proc.command, workdir));

const findPids = (target: TelegramTarget): Promise<number[]> =>
  process.platform === 'win32'
    ? findWindowsPidsByPath(target.exe)
    : process.platform === 'linux'
      ? findLinuxTelegramPids(target.workdir)
      : process.platform === 'darwin'
        ? findDarwinTelegramPids(target.workdir)
        : Promise.resolve([]);

export const killTelegramProcesses = async (target: TelegramTarget): Promise<void> => {
  const pids = await findPids(target);
  if (pids.length === 0) return;
  if (process.platform === 'win32') {
    for (const pid of pids) {
      try {
        await execFileAsync('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true });
      } catch {}
    }
    return;
  }
  signalPids(pids, 'SIGTERM');
  if (await waitUntilGone(async () => (await findPids(target)).length > 0, 4000)) return;
  signalPids(await findPids(target), 'SIGKILL');
};

/** Resolves true once nothing is running from `target`, false if the timeout expires. */
export const waitForTelegramExit = async (
  target: TelegramTarget,
  timeoutMs = 5000,
): Promise<boolean> =>
  process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin'
    ? waitUntilGone(async () => (await findPids(target)).length > 0, timeoutMs)
    : true;

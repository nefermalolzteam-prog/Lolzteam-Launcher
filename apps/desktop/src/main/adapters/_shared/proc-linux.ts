import { readFile, readdir, readlink } from 'node:fs/promises';

// Process lookup on Linux without shelling out. `/proc/<pid>/exe` is a symlink
// to the running binary and `/proc/<pid>/cmdline` its NUL-separated argv, both
// readable for processes owned by the same uid — which is exactly the set we
// care about, since Steam and Telegram run as the user who started us. Anything
// we cannot read (root daemons, processes that exited mid-scan) is skipped.

export interface LinuxProcess {
  pid: number;
  /** Absolute path of the running binary, or null if unreadable. */
  exe: string | null;
  argv: readonly string[];
}

const readProcess = async (pid: number): Promise<LinuxProcess | null> => {
  let exe: string | null = null;
  try {
    exe = await readlink(`/proc/${pid}/exe`);
  } catch {
    // Permission denied, or the process is gone. Keep it: `cmdline` may still
    // be readable and is enough for a workdir match.
  }
  let argv: string[] = [];
  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf8');
    argv = raw.split('\0').filter((part) => part !== '');
  } catch {
    if (exe === null) return null;
  }
  // A deleted binary shows up as "/path/to/exe (deleted)".
  if (exe?.endsWith(' (deleted)')) exe = exe.slice(0, -' (deleted)'.length);
  return { pid, exe, argv };
};

export const listLinuxProcesses = async (): Promise<LinuxProcess[]> => {
  let entries: string[];
  try {
    entries = await readdir('/proc');
  } catch {
    return [];
  }
  const pids = entries.map(Number).filter((pid) => Number.isInteger(pid) && pid > 0);
  const found = await Promise.all(pids.map(readProcess));
  return found.filter((proc): proc is LinuxProcess => proc !== null);
};

export const findLinuxPids = async (match: (proc: LinuxProcess) => boolean): Promise<number[]> => {
  const procs = await listLinuxProcesses();
  return procs.filter(match).map((proc) => proc.pid);
};

/** Sends `signal` to each pid, ignoring processes that already exited. */
export const signalPids = (pids: readonly number[], signal: NodeJS.Signals): void => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
};

/** Resolves once `stillRunning()` reports false, or `timeoutMs` elapses. */
export const waitUntilGone = async (
  stillRunning: () => Promise<boolean> | boolean,
  timeoutMs: number,
  pollMs = 250,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await stillRunning())) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

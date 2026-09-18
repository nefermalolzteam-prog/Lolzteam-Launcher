import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Process lookup on macOS, where /proc does not exist. `ps -axo pid=,args=`
// lists every process with its full command line, and on macOS argv[0] is the
// executable's absolute path — GUI bundles included, spaces and all
// ("…/Steam Helper.app/Contents/MacOS/Steam Helper"). Splitting the line into
// tokens would shred those paths, so consumers match against the raw remainder
// of the line, never against a token list.

export interface DarwinProcess {
  pid: number;
  /** The full command line: executable path followed by its arguments. */
  command: string;
}

export const parseDarwinPs = (stdout: string): DarwinProcess[] => {
  const found: DarwinProcess[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (Number.isInteger(pid) && pid > 0) found.push({ pid, command: match[2] ?? '' });
  }
  return found;
};

export const listDarwinProcesses = async (): Promise<DarwinProcess[]> => {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,args=']);
    return parseDarwinPs(stdout);
  } catch {
    return [];
  }
};

export const findDarwinPids = async (
  match: (proc: DarwinProcess) => boolean,
): Promise<number[]> => {
  const procs = await listDarwinProcesses();
  return procs.filter((proc) => proc.pid !== process.pid && match(proc)).map((proc) => proc.pid);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when the command line carries `-workdir <dir>` as a standalone flag
 * pair. The directory is matched as a whole word, so a workdir with spaces
 * (`…/Application Support/…`) still matches exactly once, and a longer path
 * that merely starts with it does not match at all.
 */
export const hasWorkdirFlag = (command: string, workdir: string): boolean =>
  new RegExp(`(^|\\s)-workdir ${escapeRegExp(workdir)}($|\\s)`).test(command);

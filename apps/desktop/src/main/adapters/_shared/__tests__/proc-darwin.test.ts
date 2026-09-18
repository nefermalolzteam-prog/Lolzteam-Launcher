import { describe, expect, it } from 'vitest';
import { hasWorkdirFlag, parseDarwinPs } from '../proc-darwin';

describe('parseDarwinPs', () => {
  it('reads pid and the full command line, spaces included', () => {
    const ps = [
      '  501 /Applications/Steam.app/Contents/MacOS/Steam -shutdown',
      '  502 /Applications/Steam.app/Contents/Frameworks/Steam Helper.app/Contents/MacOS/Steam Helper --type=renderer',
      '    1 /sbin/launchd',
      '',
      'garbage without a pid',
    ].join('\n');
    const procs = parseDarwinPs(ps);
    expect(procs).toHaveLength(3);
    expect(procs[0]).toEqual({
      pid: 501,
      command: '/Applications/Steam.app/Contents/MacOS/Steam -shutdown',
    });
    expect(procs[1]?.command.startsWith('/Applications/Steam.app/Contents/Frameworks/')).toBe(true);
    expect(procs[2]).toEqual({ pid: 1, command: '/sbin/launchd' });
  });

  it('skips lines that are not a pid followed by a command', () => {
    expect(parseDarwinPs('PID ARGS\n12')).toEqual([]);
    expect(parseDarwinPs('')).toEqual([]);
  });
});

describe('hasWorkdirFlag', () => {
  const WD = '/Users/u/Library/Application Support/@lolzteam/desktop/telegram';

  it('matches the flag with our workdir, spaces in it and all', () => {
    expect(hasWorkdirFlag(`/Applications/Telegram -workdir ${WD}`, WD)).toBe(true);
    expect(hasWorkdirFlag(`/usr/bin/Telegram -workdir ${WD} --debug`, WD)).toBe(true);
    expect(hasWorkdirFlag(`Telegram -workdir ${WD}/`, WD)).toBe(false);
  });

  it("does not match the user's own client or a different workdir", () => {
    expect(hasWorkdirFlag('/Applications/Telegram -workdir /Users/u/other', WD)).toBe(false);
    expect(hasWorkdirFlag('/Applications/Telegram', WD)).toBe(false);
    // A directory that merely starts with our workdir is not our launch.
    expect(hasWorkdirFlag(`Telegram -workdir ${WD}2`, WD)).toBe(false);
  });
});

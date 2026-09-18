import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { isOurTelegramInstance } from '../process';

describe('isOurTelegramInstance', () => {
  const WD = '/home/u/.config/@lolzteam/desktop/telegram';

  it('matches the flag immediately followed by our workdir', () => {
    expect(isOurTelegramInstance(['/usr/bin/Telegram', '-workdir', WD], WD)).toBe(true);
    expect(isOurTelegramInstance(['/usr/bin/Telegram', '-workdir', `${WD}/`], WD)).toBe(true);
    expect(isOurTelegramInstance(['/usr/bin/Telegram', '-workdir', WD], `${WD}/`)).toBe(true);
  });

  it("does not match the user's own client", () => {
    expect(isOurTelegramInstance(['/usr/bin/Telegram'], WD)).toBe(false);
    expect(isOurTelegramInstance(['/usr/bin/Telegram', '-workdir', '/home/u/other'], WD)).toBe(
      false,
    );
  });

  it('does not match a program that merely has the directory as an argument', () => {
    expect(isOurTelegramInstance(['dolphin', WD], WD)).toBe(false);
    expect(isOurTelegramInstance(['ls', '-la', WD], WD)).toBe(false);
    // The flag at the very end, with nothing after it, is not our launch either.
    expect(isOurTelegramInstance(['/usr/bin/Telegram', WD, '-workdir'], WD)).toBe(false);
  });
});

const linuxOnly = process.platform === 'linux' ? describe : describe.skip;

linuxOnly('killTelegramProcesses on Linux', () => {
  const children: ReturnType<typeof spawn>[] = [];
  afterEach(() => {
    for (const child of children) child.kill('SIGKILL');
    children.length = 0;
  });

  it('stops only the instance started on our workdir', async () => {
    const { killTelegramProcesses, waitForTelegramExit } = await import('../process');
    const workdir = `/tmp/lolz-tg-${process.pid}-${Math.random().toString(36).slice(2)}`;
    // Both sleep; only the first carries `-workdir <ours>` the way we launch
    // Telegram. Node keeps its argv, unlike `sh -c 'sleep 30'`, whose
    // exec-optimised child would drop the flag before /proc could see it.
    const idle = 'setInterval(() => {}, 1000)';
    const ours = spawn(process.execPath, ['-e', idle, '-workdir', workdir], { stdio: 'ignore' });
    const bystander = spawn(process.execPath, ['-e', idle, workdir], { stdio: 'ignore' });
    children.push(ours, bystander);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const target = {
      exe: '/usr/bin/sh',
      args: ['-workdir', workdir],
      workdir,
      tdataDir: `${workdir}/tdata`,
      needsPortableMarker: false,
    };
    await killTelegramProcesses(target);
    expect(await waitForTelegramExit(target, 3000)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ours.exitCode !== null || ours.signalCode !== null).toBe(true);
    expect(bystander.exitCode).toBeNull();
    expect(bystander.signalCode).toBeNull();
  });
});

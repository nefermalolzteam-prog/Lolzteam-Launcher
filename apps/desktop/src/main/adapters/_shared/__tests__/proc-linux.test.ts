import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { findLinuxPids, listLinuxProcesses, signalPids, waitUntilGone } from '../proc-linux';

const linuxOnly = process.platform === 'linux' ? describe : describe.skip;

const children: ReturnType<typeof spawn>[] = [];
afterEach(() => {
  for (const child of children) child.kill('SIGKILL');
  children.length = 0;
});

/** A sleeping child with a marker in argv that no other process will carry. */
const marker = `lolz-proc-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
const spawnMarked = () => {
  // Not `sh -c 'sleep 30' <marker>`: a shell exec-optimises the last command,
  // replacing its argv with `sleep 30` and losing the marker before /proc can
  // ever see it. A node process keeps its argv for as long as it lives.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], {
    stdio: 'ignore',
  });
  children.push(child);
  return child;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const markedStillRunning = async () =>
  (await findLinuxPids((p) => p.argv.includes(marker))).length > 0;

linuxOnly('proc-linux', () => {
  it('lists our own process with its binary and argv', async () => {
    const procs = await listLinuxProcesses();
    const me = procs.find((p) => p.pid === process.pid);
    expect(me?.exe).toBe(process.execPath);
    expect(me?.argv.length).toBeGreaterThan(0);
  });

  it('finds a child by argv and stops finding it once it is gone', async () => {
    const child = spawnMarked();
    await settle();
    const found = await findLinuxPids((p) => p.argv.includes(marker));
    expect(found).toEqual([child.pid]);

    signalPids(found, 'SIGKILL');
    expect(await waitUntilGone(markedStillRunning, 3000, 50)).toBe(true);
  });

  it('ignores pids that already exited when signalling', () => {
    expect(() => signalPids([2 ** 22 - 1], 'SIGTERM')).not.toThrow();
  });

  it('reports a timeout instead of waiting forever', async () => {
    expect(await waitUntilGone(() => true, 120, 30)).toBe(false);
  });
});

import type { LocalAccountResult } from '@shared-types';
import { describe, expect, it, vi } from 'vitest';
import { runMassDelete } from '../massDelete';

const ok = (id: number): LocalAccountResult => ({ ok: true, id });
const no = (message: string): LocalAccountResult => ({ ok: false, message });

describe('runMassDelete', () => {
  it('reports every id it removed', async () => {
    const out = await runMassDelete([1, 2, 3], async (id) => ok(id));
    expect(out.removed).toEqual([1, 2, 3]);
    expect(out.failed).toEqual([]);
  });

  // The reason the loop does not stop at the first refusal.
  it('keeps going past a refusal and names the ones that stayed', async () => {
    const out = await runMassDelete([1, 2, 3], async (id) => (id === 2 ? no('not_found') : ok(id)));
    expect(out.removed).toEqual([1, 3]);
    expect(out.failed).toEqual([{ id: 2, message: 'not_found' }]);
  });

  // A broken IPC bridge is a failure of ours, not an answer from main.
  it('treats a thrown remover as that account failing', async () => {
    const out = await runMassDelete([1, 2], async (id) => {
      if (id === 1) throw new Error('bridge is gone');
      return ok(id);
    });
    expect(out.removed).toEqual([2]);
    expect(out.failed).toEqual([{ id: 1, message: 'unknown' }]);
  });

  // What the modal's «удалено N из M» is counting: attempts, including the ones that refused.
  it('counts attempts, not successes', async () => {
    const seen: number[] = [];
    await runMassDelete([1, 2, 3], async (id) => (id === 2 ? no('busy') : ok(id)), {
      onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  // Sequential on purpose — `massDelete.ts` says why.
  it('deletes one account at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    await runMassDelete([1, 2, 3, 4], async (id) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return ok(id);
    });
    expect(peak).toBe(1);
  });

  it('asks for nothing when nothing was selected', async () => {
    const remove = vi.fn(async (id: number) => ok(id));
    const out = await runMassDelete([], remove);
    expect(remove).not.toHaveBeenCalled();
    expect(out).toEqual({ removed: [], failed: [] });
  });
});

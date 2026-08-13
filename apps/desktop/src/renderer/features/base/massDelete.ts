import type { LocalAccountResult } from '@shared-types';

export interface MassDeleteFailure {
  readonly id: number;
  /** Main's machine-readable code, for `localErrorText` to turn into a sentence. */
  readonly message: string;
}

export interface MassDeleteOutcome {
  readonly removed: readonly number[];
  readonly failed: readonly MassDeleteFailure[];
}

export interface MassDeleteOptions {
  /** Called after each account, with how many of `ids` have been attempted. */
  readonly onProgress?: (done: number, total: number) => void;
}

/** Sequential on purpose. */
export const runMassDelete = async (
  ids: readonly number[],
  remove: (id: number) => Promise<LocalAccountResult>,
  options: MassDeleteOptions = {},
): Promise<MassDeleteOutcome> => {
  const removed: number[] = [];
  const failed: MassDeleteFailure[] = [];
  let done = 0;
  for (const id of ids) {
    try {
      const res = await remove(id);
      if (res.ok) removed.push(id);
      else failed.push({ id, message: res.message });
    } catch {
      failed.push({ id, message: 'unknown' });
    }
    done += 1;
    options.onProgress?.(done, ids.length);
  }
  return { removed, failed };
};

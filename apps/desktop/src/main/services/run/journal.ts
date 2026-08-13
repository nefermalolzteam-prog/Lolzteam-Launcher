import type { TelegramRunSummary, TelegramTaskKind } from '@shared-types';
import { recordAction } from '../action-log';

/** One journal entry for one mass run. */
export const recordRun = (
  kind: TelegramTaskKind,
  summary: TelegramRunSummary,
  durationMs: number,
): void => {
  const parts = [`${summary.ok}/${summary.total} ok`];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  if (summary.stopped !== null) parts.push(summary.stopped);
  recordAction({
    action: `run.${kind}`,
    // A run the user stopped is not a failed run — see `classifyError`.
    status:
      summary.stopped === 'cancelled'
        ? 'cancelled'
        : summary.failed > 0 || summary.stopped !== null
          ? 'fail'
          : 'ok',
    durationMs,
    detail: parts.join(', '),
  });
};

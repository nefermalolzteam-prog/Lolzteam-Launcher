import type { RateLimitInfo } from './types';

const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Pulls the rate-limit block out of a response body. */
export const readRateLimit = (body: unknown): RateLimitInfo | null => {
  if (typeof body !== 'object' || body === null) return null;
  const info = (body as { system_info?: unknown }).system_info;
  if (typeof info !== 'object' || info === null) return null;
  const block = (info as { rate_limit?: unknown }).rate_limit;
  if (typeof block !== 'object' || block === null) return null;

  const { limit, remaining, reset } = block as Record<string, unknown>;
  const [l, r, at] = [asCount(limit), asCount(remaining), asCount(reset)];
  // A partial block is not a usable one: pacing needs both how much is left and when it comes back.
  return l === null || r === null || at === null ? null : { limit: l, remaining: r, reset: at };
};

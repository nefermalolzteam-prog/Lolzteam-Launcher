/** One line of the API monitor's «recent requests» table. */
export interface ApiMonitorEntry {
  /** Epoch ms. */
  at: number;
  method: string;
  /** Path relative to the API root, e.g. `user/orders`. */
  path: string;
  status: number;
  durationMs: number;
}

/** The whole monitor at a glance, computed in main from the call journal. */
export interface ApiMonitorSnapshot {
  /** Newest first, capped by the journal. */
  recent: readonly ApiMonitorEntry[];
  /** Requests per minute over the last hour, oldest bucket first — exactly 60 slots. */
  perMinute: readonly number[];
  /** Everything the journal still holds (it holds an hour). */
  lastHour: number;
  /** The newest bucket of `perMinute`. */
  lastMinute: number;
  /** The server's own rate-limit trio from the last answer that carried it. */
  limit: number | null;
  remaining: number | null;
  /** Unix seconds; `null` until the server has said. */
  reset: number | null;
}

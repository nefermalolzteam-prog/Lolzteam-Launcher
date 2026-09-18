import { describe, expect, it } from 'vitest';
import { apiMonitorSnapshot, recordApiCall, resetApiMonitorForTests } from '../api-monitor';

const call = (at: number, over: Partial<Parameters<typeof recordApiCall>[0]> = {}) => ({
  at,
  method: 'GET',
  path: 'user/orders',
  status: 200,
  durationMs: 120,
  ...over,
});

describe('api-monitor', () => {
  it('counts calls into per-minute buckets, newest last', () => {
    resetApiMonitorForTests();
    const now = Date.now();
    recordApiCall(call(now));
    recordApiCall(call(now));
    recordApiCall(call(now - 60_000));
    const snap = apiMonitorSnapshot(now + 1000);
    expect(snap.lastHour).toBe(3);
    expect(snap.perMinute).toHaveLength(60);
    // The bucket that was «now» a second ago is second from the end.
    expect(snap.perMinute[58]).toBe(1);
    expect(snap.perMinute[59]).toBe(2);
  });

  it('keeps the server trio from the last answer that carried it', () => {
    resetApiMonitorForTests();
    recordApiCall(call(Date.now(), { limit: 90, remaining: 88, reset: 1_800_000_000 }));
    const snap = apiMonitorSnapshot();
    expect(snap.limit).toBe(90);
    expect(snap.remaining).toBe(88);
    expect(snap.reset).toBe(1_800_000_000);
  });

  it('a 429 without numbers still says the ceiling was hit', () => {
    resetApiMonitorForTests();
    recordApiCall(call(Date.now(), { limit: 90, remaining: 3, reset: 1_800_000_000 }));
    recordApiCall(call(Date.now(), { status: 429 }));
    const snap = apiMonitorSnapshot();
    expect(snap.remaining).toBe(0);
    expect(snap.limit).toBe(90);
  });

  it('drops entries older than an hour from the window and the count', () => {
    resetApiMonitorForTests();
    const now = Date.now();
    recordApiCall(call(now - 61 * 60_000));
    recordApiCall(call(now - 5 * 60_000));
    recordApiCall(call(now));
    const snap = apiMonitorSnapshot(now);
    expect(snap.lastHour).toBe(2);
    expect(snap.recent).toHaveLength(2);
  });

  it('lists recent requests newest first and without the rate-limit fields', () => {
    resetApiMonitorForTests();
    const now = Date.now();
    recordApiCall(call(now - 1000, { path: 'me', status: 200 }));
    recordApiCall(call(now, { path: '42/mafile', status: 429, durationMs: 40 }));
    const snap = apiMonitorSnapshot(now);
    expect(snap.recent[0]?.path).toBe('42/mafile');
    expect(snap.recent[1]?.path).toBe('me');
    expect(Object.hasOwn(snap.recent[0] ?? {}, 'remaining')).toBe(false);
  });
});

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LauncherSettings } from '@shared-types';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  userData: '',
  version: '1.2.3',
  packaged: true,
  settings: {} as Partial<LauncherSettings>,
  patches: [] as Partial<LauncherSettings>[],
  listeners: [] as ((s: Partial<LauncherSettings>) => void)[],
  fetch: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => h.userData,
    getVersion: () => h.version,
    get isPackaged() {
      return h.packaged;
    },
  },
}));

vi.mock('electron-log/main', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../api-session', () => ({
  appFetch: (...args: unknown[]) => h.fetch(...args),
}));

vi.mock('../../settings/settings-store', () => ({
  getSettings: async () => h.settings,
  setSettings: async (patch: Partial<LauncherSettings>) => {
    h.patches.push(patch);
    Object.assign(h.settings, patch);
    return h.settings;
  },
  onSettingsChange: (fn: (s: Partial<LauncherSettings>) => void) => {
    h.listeners.push(fn);
    return () => undefined;
  },
}));

// Read at import time by the module under test, so it is set before any `load`.
process.env.LAUNCHER_TELEMETRY_KEY = 'test-key';

const load = async (enabled: boolean | null = true) => {
  h.userData = mkdtempSync(join(tmpdir(), 'lzt-metrics-'));
  h.settings = { metricsEnabled: enabled, locale: 'ru' };
  h.patches = [];
  h.listeners = [];
  h.packaged = true;
  h.fetch.mockReset();
  vi.resetModules();
  return import('../metrics');
};

const stateFile = () => join(h.userData, 'metrics.json');
const stored = () => JSON.parse(readFileSync(stateFile(), 'utf8'));
const answer = (status: number, body: unknown = {}) => ({ status, json: async () => body });

// Imported once for the pure helpers, which need no state of any kind.
const { coarseOsVersion: coarse, sampledIn } = await import('../metrics');

describe('coarseOsVersion', () => {
  it('tells 11 from 10 by the build, and reports neither', () => {
    // Windows calls itself `10.0.x` either way; the build is the only thing that separates them.
    expect(coarse('win32', '10.0.26200')).toBe('11');
    expect(coarse('win32', '10.0.19045')).toBe('10');
  });

  it('turns a darwin kernel into the macOS people name', () => {
    expect(coarse('darwin', '23.5.0')).toBe('14');
  });

  it('keeps the kernel major on linux and refuses nonsense', () => {
    expect(coarse('linux', '6.8.0-45-generic')).toBe('6');
    expect(coarse('linux', 'unknown')).toBeUndefined();
  });
});

describe('sampling', () => {
  it('is decided by the install and never by the launch', () => {
    const id = '7b1c2f10-2d3e-4a5b-8c9d-0e1f2a3b4c5d';
    const first = sampledIn(id, 0.5);
    for (let i = 0; i < 5; i++) expect(sampledIn(id, 0.5)).toBe(first);
  });

  it('takes everyone at 1 and nobody at 0', () => {
    const id = '7b1c2f10-2d3e-4a5b-8c9d-0e1f2a3b4c5d';
    expect(sampledIn(id, 1)).toBe(true);
    expect(sampledIn(id, 0)).toBe(false);
  });
});

describe('consent', () => {
  it('writes nothing at all until it has been given', async () => {
    const m = await load(null);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    // Not an empty file, not a file with an id waiting to be used: none.
    expect(existsSync(stateFile())).toBe(false);
  });

  it('keeps the identifier out of the settings file', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    await m.setMetricsEnabled(false);
    // Settings travel to other machines in backups; an id that travelled with them would turn one install into five.
    for (const patch of h.patches) expect(Object.keys(patch)).toEqual(['metricsEnabled']);
    expect(JSON.stringify(h.settings)).not.toContain(stored().installId);
  });

  it('drops what is queued when it is switched off', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    expect(stored().queue).toHaveLength(1);

    await m.setMetricsEnabled(false);
    expect(stored().queue).toHaveLength(0);
    await m.flushMetrics();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('the queue', () => {
  it('is bounded, and keeps the newest', async () => {
    const m = await load(true);
    for (let i = 0; i < 25; i++) m.trackMetric('app.launch', {});
    await m.metricsIdle();
    expect(stored().queue).toHaveLength(20);
  });

  it('refuses an event the registry cannot describe', async () => {
    const m = await load(true);
    // A version that fails the receiver's own regex would come back rejected; it never leaves.
    m.trackMetric('app.update', { from: 'nightly' });
    await m.metricsIdle();
    expect(existsSync(stateFile())).toBe(false);
  });
});

describe('one attempt per launch', () => {
  it('sends the envelope the contract describes, and clears what was accepted', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    h.fetch.mockResolvedValue(answer(200, { accepted: 1, rejected: 0 }));

    await m.flushMetrics();

    const [url, init] = h.fetch.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toContain('/api/launcher/events');
    expect(init.headers['X-Telemetry-Key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      schema: 1,
      app_version: '1.2.3',
      os: process.platform,
      locale: 'ru',
    });
    expect(body.events).toHaveLength(1);
    // `app.launch` carries no props on the wire; a `{}` would be a key the receiver has to decide about.
    expect(body.events[0]).toEqual({
      id: expect.any(String),
      name: 'app.launch',
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(stored().queue).toHaveLength(0);
  });

  it('keeps the queue on 429 and throws the batch away on 400', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    h.fetch.mockResolvedValue(answer(429, {}));
    await m.flushMetrics();
    expect(stored().queue).toHaveLength(1);

    const m2 = await load(true);
    m2.trackMetric('app.launch', {});
    await m2.metricsIdle();
    h.fetch.mockResolvedValue(answer(400, { error: { code: 'bad_envelope' } }));
    await m2.flushMetrics();
    // Malformed is malformed forever — resending it would fail identically.
    expect(stored().queue).toHaveLength(0);
  });

  it('remembers a receiver that switched it off, across restarts', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    h.fetch.mockResolvedValue(
      answer(200, { accepted: 1, rejected: 0, config: { enabled: false } }),
    );
    await m.flushMetrics();
    expect(stored().config.enabled).toBe(false);

    // Same machine, next run: the switch has to survive, or it is not a switch.
    const dir = h.userData;
    vi.resetModules();
    h.fetch.mockClear();
    h.userData = dir;
    const next = await import('../metrics');
    next.trackMetric('app.launch', {});
    await next.metricsIdle();
    await next.flushMetrics();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('asks again once that refusal has gone stale', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    h.fetch.mockResolvedValue(
      answer(200, { accepted: 1, rejected: 0, config: { enabled: false } }),
    );
    await m.flushMetrics();

    // A week on. `config` only ever arrives as the answer to a send.
    const dir = h.userData;
    const state = stored();
    state.configAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    writeFileSync(stateFile(), JSON.stringify(state), 'utf8');

    vi.resetModules();
    h.fetch.mockClear();
    h.userData = dir;
    const next = await import('../metrics');
    next.trackMetric('app.launch', {});
    await next.metricsIdle();
    await next.flushMetrics();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the network does not answer', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    h.fetch.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(m.flushMetrics()).resolves.toBeUndefined();
    expect(stored().queue).toHaveLength(1);
  });
});

describe('the state file', () => {
  it('is never overwritten when it cannot be read', async () => {
    const m = await load(true);
    writeFileSync(stateFile(), '{ not json', 'utf8');
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    // The house rule for anything at rest: a file that will not parse may be ignored, but never replaced.
    expect(readFileSync(stateFile(), 'utf8')).toBe('{ not json');
  });

  it('does not exist in a development build', async () => {
    const m = await load(true);
    h.packaged = false;
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    expect(existsSync(stateFile())).toBe(false);
  });
});

describe('the preview', () => {
  it('is the request itself, not a description of it', async () => {
    const m = await load(true);
    m.trackMetric('app.launch', {});
    await m.metricsIdle();
    const body = JSON.parse(await m.previewMetricsPayload());
    expect(body.install_id).toBe(stored().installId);
    expect(body.events[0].name).toBe('app.launch');
  });
});

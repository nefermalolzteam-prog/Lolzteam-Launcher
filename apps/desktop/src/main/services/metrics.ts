import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { LOLZ_CONFIG } from '@shared-ipc';
import {
  DEFAULT_METRICS_CONFIG,
  METRICS_MAX_BODY_BYTES,
  METRICS_MAX_EVENTS,
  METRICS_SCHEMA,
  METRIC_ARCH,
  type MetricArch,
  type MetricEvent,
  type MetricEventName,
  type MetricFeature,
  type MetricInput,
  type MetricOs,
  type MetricsAccepted,
  type MetricsConfig,
  type MetricsEnvelope,
  type MetricsState,
  buildMetricEvent,
  isMetricFeature,
  isMetricOsVersion,
  isMetricVersion,
  metricsDay,
} from '@shared-types';
import { app } from 'electron';
import log from 'electron-log/main';
import { getSettings, onSettingsChange, setSettings } from '../settings/settings-store';
import { appFetch } from './api-session';

const FILE_NAME = 'metrics.json';

/** Bumped when `Stored` changes shape; an older file is dropped, not migrated. */
const VERSION = 1;

/** How much undelivered history is worth keeping. */
const QUEUE_MAX = 20;

const SEND_TIMEOUT_MS = 5_000;

/** Start is the one moment the user is watching a clock, so the metric stays out of it. */
const SEND_DELAY_MIN_MS = 30_000;
const SEND_DELAY_SPAN_MS = 30_000;

/** Payload goes to the log instead of the network — `docs/METRICS.md` §10. */
const DRY_RUN = process.env.METRICS_DRY_RUN === '1';

/** How long the receiver's «нет» is believed. */
const CONFIG_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

/** The receiver's key. */
const INGEST_KEY =
  process.env.LAUNCHER_TELEMETRY_KEY ??
  (typeof __TELEMETRY_KEY__ === 'string' ? __TELEMETRY_KEY__ : '');

interface Stored {
  version: number;
  installId: string;
  createdAt: number;
  /** What the app ran as last time — how `app.update` tells an update from a reinstall. */
  lastVersion?: string;
  queue: MetricEvent[];
  /** One day's counters, folded into `feature.use` once that day is over. */
  counters?: { day: string; counts: Record<string, number> };
  /** The last `config` the receiver sent. */
  config?: MetricsConfig;
  /** When that `config` arrived — it is believed for `CONFIG_TTL_MS`, no longer. */
  configAt?: number;
  lastSentAt?: number;
  /** The version whose key was refused — sending resumes after an update. */
  refusedBy?: string;
}

const stateFile = (): string => join(app.getPath('userData'), FILE_NAME);

const freshState = (): Stored => ({
  version: VERSION,
  installId: randomUUID(),
  createdAt: Date.now(),
  queue: [],
});

let cached: Stored | null = null;
/** Set when the file on disk exists but could not be read. */
let frozen = false;
let writing: Promise<void> = Promise.resolve();

const load = async (): Promise<Stored> => {
  if (cached) return cached;
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile(), 'utf8')) as Partial<Stored>;
    cached =
      parsed.version === VERSION && typeof parsed.installId === 'string' && parsed.installId !== ''
        ? {
            ...freshState(),
            ...parsed,
            installId: parsed.installId,
            queue: Array.isArray(parsed.queue) ? parsed.queue.slice(-QUEUE_MAX) : [],
          }
        : freshState();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('[metrics] state unreadable, running without persistence');
      frozen = true;
    }
    cached = freshState();
  }
  return cached;
};

/** `0o600`, atomic: a crash mid-write cannot leave a half-written identifier. */
const save = (): Promise<void> => {
  const state = cached;
  if (state === null || frozen) return writing;
  writing = writing.then(async () => {
    const path = stateFile();
    const tmp = `${path}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(tmp, path);
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      log.warn('[metrics] failed to write state', err);
    }
  });
  return writing;
};

/** A coarse OS label — `11`, `10`, `14` — and never a build number. */
export const coarseOsVersion = (platform: string, rel: string): string | undefined => {
  const parts = rel.split('.').map((p) => Number.parseInt(p, 10));
  const major = parts[0];
  if (major === undefined || !Number.isFinite(major)) return undefined;
  if (platform === 'win32') {
    const build = parts[2];
    if (major === 10) return build !== undefined && build >= 22000 ? '11' : '10';
    return major > 0 && major < 1000 ? String(major) : undefined;
  }
  if (platform === 'darwin') return major >= 20 ? String(major - 9) : undefined;
  return major > 0 && major < 1000 ? String(major) : undefined;
};

const osOf = (platform: string): MetricOs | null =>
  platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : null;

const archOf = (arch: string): MetricArch | undefined =>
  (METRIC_ARCH as readonly string[]).includes(arch) ? (arch as MetricArch) : undefined;

/** Whether this build has a metric at all. */
export const isMetricsAvailable = (): boolean =>
  DRY_RUN || (app.isPackaged && INGEST_KEY !== '' && osOf(process.platform) !== null);

const configOf = (state: Stored): MetricsConfig =>
  state.config !== undefined && Date.now() - (state.configAt ?? 0) < CONFIG_TTL_MS
    ? state.config
    : DEFAULT_METRICS_CONFIG;

/** Whether this install is inside the receiver's sample. */
export const sampledIn = (installId: string, sample: number): boolean => {
  if (!(sample > 0)) return false;
  if (sample >= 1) return true;
  const digest = createHash('sha256').update(installId).digest();
  return digest.readUInt32BE(0) % 1000 < Math.round(sample * 1000);
};

/** Every reason the queue would not be sent, in one place. */
const stoppedReason = (state: Stored): string | null => {
  const config = configOf(state);
  if (!config.enabled) return 'receiver switched it off';
  if (METRICS_SCHEMA < config.min_schema) return 'client schema too old';
  if (state.refusedBy === app.getVersion()) return 'key refused by the receiver';
  if (!sampledIn(state.installId, config.sample)) return 'outside the sample';
  return null;
};

const enqueue = (state: Stored, event: MetricEvent): void => {
  state.queue = [...state.queue, event].slice(-QUEUE_MAX);
};

/** Everything the two `track` doors started, in order. */
let work: Promise<void> = Promise.resolve();

const doWork = (task: () => Promise<void>): void => {
  work = work.then(task).catch((err) => log.debug('[metrics] task failed', err));
};

/** Resolves once every started counter has reached the disk. */
export const metricsIdle = async (): Promise<void> => {
  await work;
  await writing;
};

/** Writes one event down. */
export const trackMetric = <N extends MetricEventName>(name: N, input: MetricInput<N>): void => {
  doWork(async () => {
    if (!isMetricsAvailable()) return;
    const settings = await getSettings();
    if (settings.metricsEnabled !== true) return;
    const state = await load();
    const event = buildMetricEvent(name, input, metricsDay(Date.now()), randomUUID());
    if (event === null) return;
    enqueue(state, event);
    await save();
  });
};

/** Bumps one day's counter for a feature. */
export const trackFeature = (feature: MetricFeature): void => {
  doWork(async () => {
    if (!isMetricsAvailable() || !isMetricFeature(feature)) return;
    const settings = await getSettings();
    if (settings.metricsEnabled !== true) return;
    const state = await load();
    const day = metricsDay(Date.now());
    const counters = state.counters?.day === day ? state.counters : { day, counts: {} };
    counters.counts[feature] = (counters.counts[feature] ?? 0) + 1;
    state.counters = counters;
    await save();
  });
};

/** Yesterday's counters become events; today's keep counting. */
const rollCounters = (state: Stored, today: string): void => {
  const counters = state.counters;
  if (!counters || counters.day === today) return;
  for (const [feature, count] of Object.entries(counters.counts)) {
    if (!isMetricFeature(feature)) continue;
    const event = buildMetricEvent('feature.use', { feature, count }, counters.day, randomUUID());
    if (event !== null) enqueue(state, event);
  }
  state.counters = undefined;
};

const envelopeFor = async (state: Stored, events: MetricEvent[]): Promise<MetricsEnvelope> => {
  const os = osOf(process.platform) ?? 'win32';
  const version = app.getVersion();
  const osVersion = coarseOsVersion(process.platform, release());
  const arch = archOf(process.arch);
  const locale = (await getSettings()).locale;
  return {
    schema: METRICS_SCHEMA,
    install_id: state.installId,
    app_version: isMetricVersion(version) ? version : '0.0.0',
    os,
    ...(osVersion !== undefined && isMetricOsVersion(osVersion) ? { os_version: osVersion } : {}),
    ...(arch !== undefined ? { arch } : {}),
    ...(locale === 'ru' || locale === 'en' ? { locale } : {}),
    events,
  };
};

/** As many of the oldest events as fit, oldest first. */
const batchFor = async (state: Stored): Promise<{ body: string; count: number } | null> => {
  let count = Math.min(state.queue.length, METRICS_MAX_EVENTS);
  while (count > 0) {
    const body = JSON.stringify(await envelopeFor(state, state.queue.slice(0, count)));
    if (Buffer.byteLength(body, 'utf8') <= METRICS_MAX_BODY_BYTES) return { body, count };
    count = Math.floor(count / 2);
  }
  return null;
};

const readConfig = (raw: unknown): MetricsConfig | null => {
  if (raw === null || typeof raw !== 'object') return null;
  const bag = raw as Partial<MetricsConfig>;
  return {
    enabled: typeof bag.enabled === 'boolean' ? bag.enabled : DEFAULT_METRICS_CONFIG.enabled,
    sample:
      typeof bag.sample === 'number' && bag.sample >= 0 && bag.sample <= 1
        ? bag.sample
        : DEFAULT_METRICS_CONFIG.sample,
    min_schema:
      typeof bag.min_schema === 'number' && Number.isInteger(bag.min_schema)
        ? bag.min_schema
        : DEFAULT_METRICS_CONFIG.min_schema,
    pow_bits:
      typeof bag.pow_bits === 'number' && Number.isInteger(bag.pow_bits)
        ? bag.pow_bits
        : DEFAULT_METRICS_CONFIG.pow_bits,
  };
};

/** What the client does with each answer from the receiver. */
const applyStatus = (state: Stored, status: number, sent: number): void => {
  if (status === 200) {
    state.queue = state.queue.slice(sent);
    state.lastSentAt = Date.now();
    return;
  }
  if (status === 400) {
    state.queue = state.queue.slice(sent);
    return;
  }
  if (status === 401) {
    state.refusedBy = app.getVersion();
    return;
  }
  if (status === 413) {
    state.queue = state.queue.slice(sent).slice(Math.ceil(state.queue.length / 2));
    return;
  }
  // 429, 5xx, 404 — the queue survives and the next launch tries again.
};

let flushed = false;

/** One attempt, and only one, per run of the app. */
export const flushMetrics = async (): Promise<void> => {
  if (!isMetricsAvailable() || flushed) return;
  const settings = await getSettings();
  if (settings.metricsEnabled !== true) return;
  const state = await load();
  const stopped = stoppedReason(state);
  if (stopped !== null) {
    log.debug(`[metrics] not sending: ${stopped}`);
    return;
  }
  const batch = await batchFor(state);
  if (batch === null) return;
  flushed = true;

  if (DRY_RUN) {
    log.info(`[metrics] dry run, would POST ${LOLZ_CONFIG.telemetryUrl}\n${batch.body}`);
    applyStatus(state, 200, batch.count);
    await save();
    return;
  }

  try {
    const res = await appFetch(LOLZ_CONFIG.telemetryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telemetry-Key': INGEST_KEY },
      body: batch.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.status === 200) {
      const answer = (await res.json().catch(() => null)) as MetricsAccepted | null;
      const config = readConfig(answer?.config);
      if (config !== null) {
        state.config = config;
        state.configAt = Date.now();
      }
    }
    applyStatus(state, res.status, batch.count);
  } catch {
    // Network, timeout, DNS.
  }
  await save();
};

let begun = false;

/** The launch bookkeeping, run once consent is in hand. */
const begin = async (): Promise<void> => {
  if (begun) return;
  begun = true;
  const state = await load();
  const today = metricsDay(Date.now());
  rollCounters(state, today);

  const version = app.getVersion();
  if (state.lastVersion !== undefined && state.lastVersion !== version) {
    const event = buildMetricEvent('app.update', { from: state.lastVersion }, today, randomUUID());
    if (event !== null) enqueue(state, event);
  }
  state.lastVersion = version;

  const launch = buildMetricEvent('app.launch', {}, today, randomUUID());
  if (launch !== null) enqueue(state, launch);
  await save();

  setTimeout(
    () => void flushMetrics(),
    SEND_DELAY_MIN_MS + Math.floor(Math.random() * SEND_DELAY_SPAN_MS),
  ).unref?.();
};

/** Starts the metric if it is allowed to start. */
export const initMetrics = (): void => {
  if (!isMetricsAvailable()) return;
  void getSettings()
    .then((settings) => {
      if (settings.metricsEnabled === true) return begin();
      onSettingsChange((next) => {
        if (next.metricsEnabled === true) void begin();
      });
      return undefined;
    })
    .catch((err) => log.debug('[metrics] init failed', err));
};

export const getMetricsState = async (): Promise<MetricsState> => {
  const settings = await getSettings();
  const available = isMetricsAvailable();
  if (!available || settings.metricsEnabled !== true) {
    return {
      enabled: settings.metricsEnabled,
      available,
      installId: cached?.installId ?? null,
      queued: cached?.queue.length ?? 0,
      lastSentAt: cached?.lastSentAt ?? null,
      stopped: false,
    };
  }
  const state = await load();
  return {
    enabled: true,
    available,
    installId: state.installId,
    queued: state.queue.length,
    lastSentAt: state.lastSentAt ?? null,
    stopped: stoppedReason(state) !== null,
  };
};

/** The answer to the question, whichever way it went. */
export const setMetricsEnabled = async (enabled: boolean): Promise<MetricsState> => {
  await setSettings({ metricsEnabled: enabled });
  if (!enabled && cached !== null) {
    cached.queue = [];
    cached.counters = undefined;
    await save();
  }
  return getMetricsState();
};

/** A new identifier and an empty queue — everything this install had said, unsaid. */
export const resetMetricsInstallId = async (): Promise<MetricsState> => {
  const state = await load();
  state.installId = randomUUID();
  state.createdAt = Date.now();
  state.queue = [];
  state.counters = undefined;
  state.lastSentAt = undefined;
  await save();
  return getMetricsState();
};

/** Exactly what the next request would carry, as text. */
export const previewMetricsPayload = async (): Promise<string> => {
  const state = cached ?? {
    ...freshState(),
    installId: '00000000-0000-4000-8000-000000000000',
  };
  const today = metricsDay(Date.now());
  const events =
    state.queue.length > 0
      ? state.queue.slice(0, METRICS_MAX_EVENTS)
      : [buildMetricEvent('app.launch', {}, today, '00000000-0000-4000-8000-000000000001')].filter(
          (e): e is MetricEvent => e !== null,
        );
  return JSON.stringify(await envelopeFor(state, events), null, 2);
};

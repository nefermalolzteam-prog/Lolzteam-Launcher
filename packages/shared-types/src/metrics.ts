import type { ServiceId, SupportedServiceId } from './service-registry';

/** Envelope version. */
export const METRICS_SCHEMA = 1;

/** Body limit of the receiver (`http.MaxBytesReader`); over it answers `413`. */
export const METRICS_MAX_BODY_BYTES = 16 * 1024;

/** Events per envelope. */
export const METRICS_MAX_EVENTS = 32;

/** `^\d+\.\d+\.\d+(-…)?$` — the receiver's rule for `app_version` and `app.update.from`. */
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,16})?$/;

export const isMetricVersion = (value: string): boolean =>
  value.length <= 32 && VERSION_RE.test(value);

/** A coarse OS label — `11`, `10`, `14`. */
const OS_VERSION_RE = /^[0-9]{1,3}(\.[0-9]{1,3})?$/;

export const isMetricOsVersion = (value: string): boolean =>
  value.length <= 8 && OS_VERSION_RE.test(value);

export type MetricOs = 'win32' | 'darwin' | 'linux';
export type MetricArch = 'x64' | 'arm64' | 'ia32';

export const METRIC_OS: readonly MetricOs[] = ['win32', 'darwin', 'linux'];
export const METRIC_ARCH: readonly MetricArch[] = ['x64', 'arm64', 'ia32'];

/** What `feature.use` may count, spelled out rather than derived. */
export const METRIC_FEATURES = [
  'login.steam',
  'login.telegram',
  'login.discord',
  'login.instagram',
  'login.tiktok',
  'login.llm',
  'base.import',
  'base.export',
  'base.check',
  'proxy.import',
  'proxy.check',
  'mass.check',
  'settings.open',
  'log.open',
] as const;

export type MetricFeature = (typeof METRIC_FEATURES)[number];

export const isMetricFeature = (value: string): value is MetricFeature =>
  (METRIC_FEATURES as readonly string[]).includes(value);

/** The counter a successful login into this service belongs to. */
export const LOGIN_FEATURE: Record<SupportedServiceId, MetricFeature> = {
  steam: 'login.steam',
  telegram: 'login.telegram',
  tiktok: 'login.tiktok',
  instagram: 'login.instagram',
  discord: 'login.discord',
  llm: 'login.llm',
};

/** The counter for a service id that may be anything — the caller's view. */
export const loginFeatureFor = (id: ServiceId | null | undefined): MetricFeature | null =>
  id ? ((LOGIN_FEATURE as Partial<Record<ServiceId, MetricFeature>>)[id] ?? null) : null;

/** How high one day's counter can climb before it stops being interesting. */
export const METRIC_COUNT_MAX = 1000;

/** `app.launch` carries no props at all — the envelope already says everything. */
export type EmptyMetricProps = Record<string, never>;

export interface AppUpdateProps {
  /** The version this install ran as before. */
  from: string;
}

export interface FeatureUseProps {
  feature: MetricFeature;
  /** Times it happened during the day being reported, 1…1000. */
  count: number;
}

interface MetricEventSpec<P> {
  /** The props to send, or `null` to drop the event. */
  readonly props: (input: P) => Record<string, unknown> | null;
}

export const METRIC_EVENTS = {
  /** Once per start of the app, and never more often. */
  'app.launch': { props: (_input: EmptyMetricProps) => ({}) },
  /** Once after the version changed — «обновились» as distinct from «переустановили». */
  'app.update': {
    props: ({ from }: AppUpdateProps) => (isMetricVersion(from) ? { from } : null),
  },
  /** One day's worth of one counter. */
  'feature.use': {
    props: ({ feature, count }: FeatureUseProps) =>
      isMetricFeature(feature) && Number.isInteger(count) && count >= 1
        ? { feature, count: Math.min(count, METRIC_COUNT_MAX) }
        : null,
  },
} as const satisfies Record<string, MetricEventSpec<never>>;

export type MetricEventName = keyof typeof METRIC_EVENTS;

/** What `trackMetric` must be handed for a given event, straight off the registry. */
export type MetricInput<N extends MetricEventName> = Parameters<
  (typeof METRIC_EVENTS)[N]['props']
>[0];

export interface MetricEvent {
  /** UUID v4. The receiver's primary key, which is what makes a resend harmless. */
  id: string;
  name: MetricEventName;
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  /** Only for an event that waited in the queue across an update. */
  app_version?: string;
  props?: Record<string, unknown>;
}

export interface MetricsEnvelope {
  schema: number;
  install_id: string;
  app_version: string;
  os: MetricOs;
  os_version?: string;
  arch?: MetricArch;
  locale?: 'ru' | 'en';
  events: MetricEvent[];
}

/** The receiver's answer, and the only thing that can change the client's mind. */
export interface MetricsConfig {
  enabled: boolean;
  /** Share of installs that send at all, decided per install and not per launch. */
  sample: number;
  min_schema: number;
  /** Proof-of-work difficulty. */
  pow_bits: number;
}

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  enabled: true,
  sample: 1,
  min_schema: METRICS_SCHEMA,
  pow_bits: 0,
};

export interface MetricsAccepted {
  accepted: number;
  rejected: number;
  config?: Partial<MetricsConfig>;
}

/** The day an event belongs to, in the only calendar the receiver keeps. */
export const metricsDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** The one constructor of a sendable event. */
export const buildMetricEvent = <N extends MetricEventName>(
  name: N,
  input: MetricInput<N>,
  day: string,
  id: string,
): MetricEvent | null => {
  const build = METRIC_EVENTS[name].props as (i: MetricInput<N>) => Record<string, unknown> | null;
  const props = build(input);
  if (props === null) return null;
  const event: MetricEvent = { id, name, day };
  if (Object.keys(props).length > 0) event.props = props;
  return event;
};

/** What the privacy page shows about the metric, and the whole of it. */
export interface MetricsState {
  /** `null` — the user has not been asked yet. */
  enabled: boolean | null;
  available: boolean;
  /** Absent until the first event is queued: consent comes before an identifier. */
  installId: string | null;
  queued: number;
  lastSentAt: number | null;
  /** The receiver switched the metric off for everyone, or for this schema. */
  stopped: boolean;
}

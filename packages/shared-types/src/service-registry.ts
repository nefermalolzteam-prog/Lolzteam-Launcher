/** Which login pipeline the renderer should render progress for. */
export type LoginFlow = 'steam' | 'telegram' | 'browser' | 'discord' | 'llm' | 'ea';

export type LoginMethod = 'native' | 'web';

export interface ServiceLoginDefinition {
  readonly flow: LoginFlow;
  /** Ordered; the first entry is the default method offered to the user. */
  readonly methods: readonly [LoginMethod, ...LoginMethod[]];
  /** May route its traffic through an account proxy. */
  readonly proxy?: boolean;
}

export interface ServiceDefinition {
  /** Human-readable brand name. */
  readonly displayName: string;
  /** lzt.market numeric category id, when the service has a dedicated one. */
  readonly categoryId?: number;
  /** Extra market category-name spellings besides the service id itself. */
  readonly aliases?: readonly string[];
  /** File name (without extension) in `renderer/assets/category/`. */
  readonly icon?: string;
  /** Present ⇔ the service has a working login adapter. */
  readonly login?: ServiceLoginDefinition;
}

/** Declaration order is meaningful: services with a `login` block are streamed. */
export const SERVICES = {
  steam: {
    displayName: 'Steam',
    categoryId: 1,
    icon: 'steam',
    login: { flow: 'steam', methods: ['native', 'web'], proxy: true },
  },
  telegram: {
    displayName: 'Telegram',
    categoryId: 24,
    icon: 'telegram',
    login: { flow: 'telegram', methods: ['native', 'web'], proxy: true },
  },
  tiktok: {
    displayName: 'TikTok',
    categoryId: 20,
    icon: 'tiktok',
    login: { flow: 'browser', methods: ['web'], proxy: true },
  },
  instagram: {
    displayName: 'Instagram',
    categoryId: 10,
    icon: 'instagram',
    login: { flow: 'browser', methods: ['web'], proxy: true },
  },
  discord: {
    displayName: 'Discord',
    categoryId: 22,
    icon: 'discord',
    login: { flow: 'discord', methods: ['web'], proxy: true },
  },
  llm: {
    displayName: 'LLM',
    categoryId: 6,
    icon: 'llm',
    login: { flow: 'llm', methods: ['web'], proxy: true },
  },

  // EA Desktop: a native Windows-only login — OAuth against EA, then the session
  // cookies land in the client's own CEF cookie store.
  ea: {
    displayName: 'EA',
    categoryId: 3,
    aliases: ['origin'],
    icon: 'ea',
    login: { flow: 'ea', methods: ['native'] },
  },

  // Known market categories without a login adapter yet. The numeric ids let a
  // market item be recognised even when its category name spelling changes.
  fortnite: { displayName: 'Fortnite', categoryId: 9 },
  mihoyo: { displayName: 'miHoYo', categoryId: 17 },
  riot: { displayName: 'Riot', categoryId: 13 },
  supercell: { displayName: 'Supercell', categoryId: 15 },
  wot: { displayName: 'World of Tanks', categoryId: 14 },
  wotblitz: { displayName: 'WoT Blitz', categoryId: 16, aliases: ['wot-blitz'] },
  gifts: { displayName: 'Gifts', categoryId: 30 },
  epicgames: { displayName: 'Epic Games', categoryId: 12, aliases: ['epic-games'] },
  eft: { displayName: 'Escape from Tarkov', categoryId: 18, aliases: ['escape-from-tarkov'] },
  socialclub: { displayName: 'Social Club', categoryId: 7, aliases: ['social-club'] },
  uplay: { displayName: 'Uplay', categoryId: 5 },
  battlenet: { displayName: 'Battle.net', categoryId: 11, aliases: ['battle-net'] },
  vpn: { displayName: 'VPN', categoryId: 19 },
  roblox: { displayName: 'Roblox', categoryId: 31 },
  warface: { displayName: 'Warface', categoryId: 4 },
  minecraft: { displayName: 'Minecraft', categoryId: 28 },
  hytale: { displayName: 'Hytale', categoryId: 8 },
  onlyfans: { displayName: 'OnlyFans', categoryId: 21 },
} as const satisfies Record<string, ServiceDefinition>;

export type ServiceId = keyof typeof SERVICES;

/** Services that declare a `login` block — exactly those that need an adapter. */
export type SupportedServiceId = {
  [K in ServiceId]: (typeof SERVICES)[K] extends { login: ServiceLoginDefinition } ? K : never;
}[ServiceId];

export const SERVICE_IDS = Object.keys(SERVICES) as readonly ServiceId[];

export const isServiceId = (v: unknown): v is ServiceId =>
  typeof v === 'string' && Object.hasOwn(SERVICES, v);

/** Widens the `as const` literal back to the interface. */
export const getService = (id: ServiceId): ServiceDefinition => SERVICES[id];

/** Streamed / selectable services, in declaration order. */
export const SUPPORTED_SERVICE_IDS = SERVICE_IDS.filter(
  (id) => getService(id).login !== undefined,
) as readonly SupportedServiceId[];

export const isSupportedServiceId = (id: ServiceId | null | undefined): id is SupportedServiceId =>
  id != null && getService(id).login !== undefined;

/** Display label for a service; falls back to the raw id for unknown values. */
export const serviceLabel = (id: ServiceId | null | undefined): string =>
  id != null && isServiceId(id) ? getService(id).displayName : String(id ?? '');

export const SERVICE_LABELS = Object.fromEntries(
  SERVICE_IDS.map((id) => [id, getService(id).displayName]),
) as Record<ServiceId, string>;

export const SERVICE_ICONS = Object.fromEntries(
  SERVICE_IDS.filter((id) => getService(id).icon !== undefined).map((id) => [
    id,
    getService(id).icon as string,
  ]),
) as Partial<Record<ServiceId, string>>;

export const loginFlowOf = (id: ServiceId | null | undefined): LoginFlow | null =>
  id != null && isServiceId(id) ? (getService(id).login?.flow ?? null) : null;

export const loginMethodsOf = (id: ServiceId | null | undefined): readonly LoginMethod[] =>
  id != null && isServiceId(id) ? (getService(id).login?.methods ?? []) : [];

/** Login methods keyed by flow rather than by service, for the renderer paths that only carry a `LoginFlow`. */
export const LOGIN_METHODS_BY_FLOW = SERVICE_IDS.reduce(
  (acc, id) => {
    const login = getService(id).login;
    if (login) acc[login.flow] = login.methods;
    return acc;
  },
  {} as Record<LoginFlow, readonly LoginMethod[]>,
);

/** The method a flow uses when the user has not chosen one explicitly. */
export const defaultLoginMethodOf = (flow: LoginFlow): LoginMethod =>
  LOGIN_METHODS_BY_FLOW[flow]?.[0] ?? 'web';

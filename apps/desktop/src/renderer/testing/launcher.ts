/** The preload API, as the renderer sees it. */
type LauncherApi = Window['launcher'];

type Overrides = Record<string, unknown>;

/** A nested namespace to descend into, as opposed to a function to hand back. */
const isNamespace = (value: unknown): value is Overrides =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One node of the stub: callable, navigable, and stable. */
const node = (overrides: Overrides, name: string): unknown => {
  const cache = new Map<string, unknown>();
  return new Proxy(() => undefined, {
    apply: () => (/^on[A-Z]/.test(name) ? () => undefined : Promise.resolve(undefined)),
    get: (target, prop, receiver) => {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      // Emphatically not a thenable: `await someNamespace` would otherwise walk into `then`, get another callable node.
      if (prop === 'then') return undefined;
      if (!cache.has(prop)) {
        const own = overrides[prop];
        const value = isNamespace(own) ? node(own, prop) : own !== undefined ? own : node({}, prop);
        cache.set(prop, value);
      }
      return cache.get(prop);
    },
  });
};

/** Builds the stub. */
export const stubLauncher = (overrides: Overrides = {}): LauncherApi =>
  node(overrides, 'launcher') as LauncherApi;

/** Installs a fresh stub on `window`, and returns it for the odd direct poke. */
export const installLauncher = (overrides: Overrides = {}): LauncherApi => {
  const api = stubLauncher(overrides);
  window.launcher = api;
  return api;
};

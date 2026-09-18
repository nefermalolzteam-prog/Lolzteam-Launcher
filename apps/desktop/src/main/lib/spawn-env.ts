// Environment sanitising for GUI apps we launch (Steam, Telegram Desktop).
//
// An AppImage's AppRun prepends the bundle's own directories to the loader and
// toolkit search paths — correct for *us*, wrong for everyone we start.
// Steam's launcher script re-execs into its runtime and refuses to start under
// a foreign `LD_LIBRARY_PATH`; Telegram Desktop picks up the bundle's GTK
// modules and dies before drawing a window. So, only when we are running from
// a bundle, every entry pointing into it is removed again: a linuxdeploy-style
// `${VAR}_ORIG` snapshot wins when present, otherwise the variable is filtered
// entry by entry and dropped if nothing of the user's own remains.
//
// A deb or dev run rewrites nothing, so the user's environment passes through
// untouched — their `LD_LIBRARY_PATH` is theirs to keep.
// No-op on Windows and macOS: nothing there rewrites the loader environment.

const LOADER_VARS = [
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'GTK_PATH',
  'GTK_IM_MODULE_FILE',
  'GDK_PIXBUF_MODULE_FILE',
  'GDK_PIXBUF_MODULEDIR',
  'GIO_MODULE_DIR',
  'GSETTINGS_SCHEMA_DIR',
  'QT_PLUGIN_PATH',
  'PYTHONHOME',
  'PYTHONPATH',
  'PERLLIB',
  'XDG_DATA_DIRS',
  'XDG_CONFIG_DIRS',
] as const;

// Variables that only ever describe *our* process. There is no original value
// to restore — a child that reads them mistakes our bundle for its own.
const DROP_VARS = [
  'APPDIR',
  'APPIMAGE',
  'ARGV0',
  'OWD',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_FORCE_IS_PACKAGED',
  'CHROME_DESKTOP',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
] as const;

const withoutBundleEntries = (value: string, appDir: string): string =>
  value
    .split(':')
    .filter((entry) => entry !== '' && !entry.startsWith(appDir) && !entry.startsWith('./'))
    .join(':');

export const cleanSpawnEnv = (
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  if (platform !== 'linux') return { ...source };

  const env: NodeJS.ProcessEnv = { ...source };
  const appDir = env.APPDIR;
  const bundled = typeof appDir === 'string' && appDir !== '';

  if (bundled) {
    for (const name of LOADER_VARS) {
      const original = env[`${name}_ORIG`];
      const current = env[name];
      if (typeof original === 'string') {
        if (original !== '') env[name] = original;
        else delete env[name];
      } else if (typeof current === 'string') {
        const kept = withoutBundleEntries(current, appDir);
        if (kept !== '') env[name] = kept;
        else delete env[name];
      }
    }
    // The `_ORIG` shadows are AppImage bookkeeping; a child seeing them would
    // conclude it is itself running from a bundle.
    for (const key of Object.keys(env)) {
      if (key.endsWith('_ORIG')) delete env[key];
    }
  }

  for (const name of DROP_VARS) delete env[name];

  return env;
};

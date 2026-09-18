/**
 * The OS this build runs on, as reported by the preload bridge.
 *
 * The renderer has no `process`, but a handful of screens describe things that
 * genuinely differ per platform — where a Telegram session is written, what a
 * file picker should filter on — and a wrong description there is worse than a
 * missing one. Read once: the value cannot change while the window is open.
 * Anything that is not a plain string (a test stub, an older preload) means
 * "unknown", which the Windows copy — the original — covers.
 */
const reported: unknown = window.launcher?.app?.platform;

export const PLATFORM: string = typeof reported === 'string' ? reported : 'win32';

export const IS_LINUX = PLATFORM === 'linux';

/** Linux and macOS share the `-workdir` client flow, so they share their UI too. */
export const IS_POSIX_DESKTOP = PLATFORM === 'linux' || PLATFORM === 'darwin';

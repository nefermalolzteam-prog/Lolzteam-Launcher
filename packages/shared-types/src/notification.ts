/** What the app tells the user about *after* it happened. */
export const NOTIFY_CATEGORIES = ['accounts', 'login', 'run', 'update', 'proxy'] as const;

export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number];

/** How the panel colours a line. */
export type NotifyLevel = 'info' | 'success' | 'warning';

/** A toast for the operating system to draw, already in the user's language. */
export interface DesktopNotification {
  readonly title: string;
  readonly body: string;
  /** Stay quiet while the window is the one in front. */
  readonly onlyWhenHidden?: boolean;
}

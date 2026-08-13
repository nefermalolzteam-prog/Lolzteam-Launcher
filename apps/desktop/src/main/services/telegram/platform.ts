import * as os from 'node:os';
import type { ICorePlatform } from '@mtcute/core';
import log from 'electron-log/main';

/** The bits of the host environment mtcute needs, minus everything that would drag `better-sqlite3` in with it. */
export class LauncherTelegramPlatform implements ICorePlatform {
  getDeviceModel(): string {
    return `Lolzteam Launcher (${os.type()} ${os.arch()})`;
  }

  getDefaultLogLevel(): number | null {
    // mtcute's own chatter goes nowhere unless a level is set explicitly per client.
    return null;
  }

  log(_color: number, level: number, tag: string, fmt: string, args: unknown[]): void {
    const line = `[mtcute:${tag}] ${fmt}`;
    if (level <= 1) log.error(line, ...args);
    else if (level === 2) log.warn(line, ...args);
    else log.info(line, ...args);
  }

  /** mtcute uses this to flush state on shutdown. */
  beforeExit(_fn: () => void): () => void {
    return () => {};
  }
}

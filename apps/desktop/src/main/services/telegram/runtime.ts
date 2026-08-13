import type { ReconnectionStrategy } from '@fuman/net';
import { MemoryStorage, type RpcCallMiddleware, networkMiddlewares } from '@mtcute/core';
import { TelegramClient } from '@mtcute/core/client.js';
import { NodeCryptoProvider, type StringSessionData } from '@mtcute/node/utils.js';
import type { ProxyEntry } from '@shared-types';
import log from 'electron-log/main';
import { LauncherTelegramPlatform } from './platform';
import { transportFor } from './transport';

/** Telegram Desktop's public API pair, used when the item carries no `telegram_json`. */
const DESKTOP_API_ID = 2040;
const DESKTOP_API_HASH = 'b18441a1ff607e10a989891a5462e627';

/** Reconnection, bounded. */
const MAX_RECONNECTS = 4;

const boundedReconnection: ReconnectionStrategy = (state) =>
  state.consequentFails >= MAX_RECONNECTS ? false : Math.min(state.consequentFails * 1_000, 5_000);

/** How long an operation may go without a single answer from Telegram. */
export const TELEGRAM_STALL_TIMEOUT_MS = 90_000;

/** How long a single request may be held back by `FLOOD_WAIT`. */
const MAX_FLOOD_WAIT_MS = 60_000;

/** Thrown when the operation falls silent; carries whatever the client last complained about. */
export class TelegramStalledError extends Error {
  constructor(last: Error | null) {
    super(
      last
        ? `Соединение с Telegram не установлено: ${last.message}`
        : 'Соединение с Telegram не установлено (таймаут)',
    );
    this.name = 'TelegramStalledError';
  }
}

export interface TelegramRuntimeParams {
  session: StringSessionData;
  apiId?: number | null;
  apiHash?: string | null;
  /** `telegram_json.device` — the device name the seller's session was created with. */
  deviceModel?: string | null;
  proxy?: ProxyEntry | null;
  /** How long to tolerate silence. */
  stallMs?: number;
}

/** The heartbeat the watchdog listens to. */
const activityMiddleware =
  (onActivity: () => void): RpcCallMiddleware =>
  async (ctx, next) => {
    try {
      return await next(ctx);
    } finally {
      onActivity();
    }
  };

export const createTelegramClient = (
  params: TelegramRuntimeParams,
  onActivity?: () => void,
): TelegramClient => {
  const apiId = params.apiId ?? DESKTOP_API_ID;
  const apiHash = params.apiHash ?? DESKTOP_API_HASH;

  const client = new TelegramClient({
    apiId,
    apiHash,
    storage: new MemoryStorage(),
    crypto: new NodeCryptoProvider(),
    platform: new LauncherTelegramPlatform(),
    transport: transportFor(params.proxy),
    reconnectionStrategy: boundedReconnection,
    // Nothing here reacts to incoming updates; every operation is a request followed by a response.
    updates: false,
    disableUpdates: true,
    initConnectionOptions: params.deviceModel ? { deviceModel: params.deviceModel } : undefined,
    network: {
      // Supplying this list *replaces* mtcute's defaults rather than adding to them.
      middlewares: [
        ...(onActivity ? [activityMiddleware(onActivity)] : []),
        ...networkMiddlewares.basic({
          floodWaiter: {
            maxWait: MAX_FLOOD_WAIT_MS,
            onBeforeWait: (ctx, seconds) => {
              // A wait is the connection working as intended.
              onActivity?.();
              log.info(`[telegram] flood wait ${seconds}s on ${ctx.request._}`);
            },
          },
        }),
      ],
    },
  });

  return client;
};

/** Runs one operation on a freshly connected client and always tears it down. */
export const withTelegramClient = async <T>(
  params: TelegramRuntimeParams,
  fn: (client: TelegramClient, signal: AbortSignal, keepAlive: () => void) => Promise<T>,
): Promise<T> => {
  const stallMs = params.stallMs ?? TELEGRAM_STALL_TIMEOUT_MS;
  const abort = new AbortController();

  let last: Error | null = null;
  let timer: NodeJS.Timeout | undefined;
  let finished = false;
  let onStall: (err: Error) => void = () => {};

  // Re-armed from the middleware on every answer.
  const arm = (): void => {
    if (finished) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const err = new TelegramStalledError(last);
      abort.abort(err);
      onStall(err);
    }, stallMs);
  };

  const client = createTelegramClient(params, arm);
  client.onError.add((err) => {
    last = err;
  });

  const signal = AbortSignal.any([abort.signal, client.stopSignal]);
  arm();

  const work = (async () => {
    await client.importSession(params.session, true);
    await client.connect();
    return await fn(client, signal, arm);
  })();
  // The watchdog can win the race, and then this promise settles with nobody waiting on it.
  work.catch(() => {});

  const deadline = new Promise<never>((_, reject) => {
    onStall = reject;
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    finished = true;
    clearTimeout(timer);
    // Whatever settled the race, `fn` must not outlive this call.
    abort.abort();
    await client.destroy().catch(() => {});
  }
};

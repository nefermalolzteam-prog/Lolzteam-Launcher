import { type TelegramRuntimeParams, withTelegramClient } from './runtime';

/** The account's own user id, asked of Telegram over the key it already has. */
export const fetchSelfId = (params: TelegramRuntimeParams): Promise<number> =>
  withTelegramClient(params, async (client) => {
    const me = await client.getMe();
    return me.id;
  });

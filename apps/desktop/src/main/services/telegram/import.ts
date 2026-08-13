import { randomUUID } from 'node:crypto';
import type { TelegramIdentifyResult, TelegramSessionFormat } from '@shared-types';
import type { LoadedTelegramSession } from './convert';
import { loadScannedSessions, parseAnyStringSession, scanConvertFolder } from './convert';

/** A key read off disk, ready to become a `LocalTelegramRecord`. */
export interface TelegramCredentials {
  readonly authKeyHex: string;
  readonly dcId: number;
  readonly userId: number | null;
  readonly phone: string | null;
  readonly format: TelegramSessionFormat;
  /** Display name of the container it came from. */
  readonly name: string;
}

const toCredentials = (loaded: LoadedTelegramSession): TelegramCredentials => ({
  authKeyHex: Buffer.from(loaded.session.authKey).toString('hex'),
  dcId: loaded.session.primaryDcs.main.id,
  userId: loaded.session.self?.userId ?? loaded.meta?.userId ?? null,
  phone: loaded.meta?.phone ?? null,
  format: loaded.format,
  name: loaded.name,
});

/** Reads every session under a path — a folder, or a single picked file. */
export const readTelegramSessions = async (path: string): Promise<TelegramCredentials[]> => {
  await scanConvertFolder(path);
  return (await loadScannedSessions(path)).map(toCredentials);
};

/** Keys waiting for the user to press "save" on the add form. */
const TICKET_TTL_MS = 10 * 60 * 1000;
const MAX_TICKETS = 32;
const tickets = new Map<string, { creds: TelegramCredentials; at: number }>();

const sweep = (): void => {
  const cutoff = Date.now() - TICKET_TTL_MS;
  for (const [token, entry] of tickets) {
    if (entry.at < cutoff) tickets.delete(token);
  }
  // A bounded map even if nothing ever expires: oldest first, insertion order.
  while (tickets.size > MAX_TICKETS) {
    const oldest = tickets.keys().next().value;
    if (oldest === undefined) break;
    tickets.delete(oldest);
  }
};

const issue = (creds: TelegramCredentials): string => {
  const token = randomUUID();
  tickets.set(token, { creds, at: Date.now() });
  sweep();
  return token;
};

/** The key behind a ticket, without spending it. */
export const peekTelegramSession = (token: string): TelegramCredentials | null => {
  const entry = tickets.get(token);
  if (!entry) return null;
  if (entry.at < Date.now() - TICKET_TTL_MS) {
    tickets.delete(token);
    return null;
  }
  return entry.creds;
};

/** Called once the record is actually stored: the ticket has done its job. */
export const consumeTelegramSession = (token: string): void => {
  tickets.delete(token);
};

/** Phone, else user id, else the tail of the key — never the key itself. */
const suggestTitle = (creds: TelegramCredentials): string =>
  creds.phone ?? (creds.userId ? `TG ${creds.userId}` : `TG …${creds.authKeyHex.slice(-6)}`);

/** Works out what the user pasted or picked. */
export const identifyTelegramSource = async (input: {
  text?: string;
  path?: string;
}): Promise<TelegramIdentifyResult> => {
  const text = input.text?.trim() ?? '';
  if (text) {
    const parsed = parseAnyStringSession(text);
    if (!parsed) return { ok: false, reason: 'unknown_format' };
    const creds = toCredentials({
      id: 'pasted',
      name: 'pasted',
      format: parsed.format,
      session: parsed.session,
      meta: null,
    });
    return {
      ok: true,
      identified: {
        token: issue(creds),
        format: creds.format,
        dcId: creds.dcId,
        userId: creds.userId,
        phone: creds.phone,
        title: suggestTitle(creds),
        more: 0,
        dir: null,
      },
    };
  }

  const path = input.path ?? '';
  if (!path) return { ok: false, reason: 'empty' };

  const found = await readTelegramSessions(path);
  const first = found[0];
  if (!first) return { ok: false, reason: 'unknown_format' };

  return {
    ok: true,
    identified: {
      token: issue(first),
      format: first.format,
      dcId: first.dcId,
      userId: first.userId,
      phone: first.phone,
      title: suggestTitle(first),
      more: found.length - 1,
      dir: path,
    },
  };
};

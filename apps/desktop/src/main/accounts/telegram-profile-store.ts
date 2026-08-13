import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { TelegramCheckInfo, TelegramProfile, TelegramSpamVerdict } from '@shared-types';
import { isTelegramSpamStatus, telegramCheckSawAccount } from '@shared-types';
import log from 'electron-log/main';
import { AVATAR_FILE, PROFILE_FILE, pathExists, writeBinaryFile } from './db-paths';
import { SidecarStore } from './sidecar-store';

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const asInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

const parseSpam = (v: unknown): TelegramSpamVerdict | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  // The guard travels with the list of statuses rather than being restated here.
  if (!isTelegramSpamStatus(r.status)) return null;
  return { status: r.status, until: asInt(r.until) };
};

const parseProfile = (v: unknown, accountId: number): TelegramProfile | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const status = asString(r.status);
  // A freeze has to survive the restart the same way a death does.
  if (status !== 'alive' && status !== 'frozen' && status !== 'dead') return null;

  return {
    // The folder names the account; the field inside is only what the machine that wrote it happened to call it.
    accountId,
    status,
    userId: asInt(r.userId),
    phone: asString(r.phone),
    username: asString(r.username),
    name: asString(r.name) ?? '',
    premium: r.premium === true,
    country: asString(r.country),
    spam: parseSpam(r.spam),
    sessions: asInt(r.sessions),
    // Replaced by `hydrate` with what is actually beside the record.
    hasAvatar: false,
    checkedAt: asInt(r.checkedAt) ?? 0,
    detail: asString(r.detail),
  };
};

const store = new SidecarStore<TelegramProfile>({
  service: 'telegram',
  file: PROFILE_FILE,
  tag: '[telegram/profile]',
  parse: parseProfile,
  hydrate: async (profile, dir) => ({
    ...profile,
    hasAvatar: await pathExists(join(dir, AVATAR_FILE)),
  }),
});

export const listTelegramProfiles = (): Promise<TelegramProfile[]> => store.list();

export const getTelegramProfile = (accountId: number): Promise<TelegramProfile | null> =>
  store.get(accountId);

/** Stores the result of one check. */
export const saveTelegramProfile = (
  accountId: number,
  info: TelegramCheckInfo,
  avatar: Uint8Array | null | undefined,
): Promise<boolean> =>
  store.save(
    accountId,
    (previous) => ({
      accountId,
      status: info.status,
      userId: info.userId ?? previous?.userId ?? null,
      phone: info.phone ?? previous?.phone ?? null,
      username: info.username ?? previous?.username ?? null,
      name: info.name || (previous?.name ?? ''),
      // `premium` is a boolean, so it cannot say "did not look" the way the nullable fields above do.
      premium: telegramCheckSawAccount(info) ? info.premium : (previous?.premium ?? false),
      country: info.country ?? previous?.country ?? null,
      // A run without the spam probe must not erase what the last one found.
      spam: info.spam ?? previous?.spam ?? null,
      sessions: info.sessions ?? previous?.sessions ?? null,
      hasAvatar: avatar === undefined ? (previous?.hasAvatar ?? false) : avatar !== null,
      checkedAt: Date.now(),
      detail: info.detail,
    }),
    async (dir) => {
      if (avatar === undefined) return;
      const path = join(dir, AVATAR_FILE);
      // Through the same tmp+rename as everything else.
      if (avatar) await writeBinaryFile(path, avatar);
      else await fs.unlink(path).catch(() => undefined);
    },
  );

/** The avatar as a `data:` URL, which is the only shape an `<img>` can take from IPC. */
export const readTelegramAvatar = async (accountId: number): Promise<string | null> => {
  if (!(await store.get(accountId))?.hasAvatar) return null;
  const dir = await store.dirFor(accountId);
  if (!dir) return null;
  try {
    const buf = await fs.readFile(join(dir, AVATAR_FILE));
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('[telegram/profile] failed to read the avatar', err);
    }
    return null;
  }
};

export const deleteTelegramProfile = (accountId: number): Promise<boolean> =>
  store.remove(accountId, async (dir) => {
    await fs.unlink(join(dir, AVATAR_FILE)).catch(() => undefined);
  });

export const resetTelegramProfileStoreForTests = (): void => store.resetForTests();

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import log from 'electron-log/main';
import { GUARD_FILE, pathExists } from '../../accounts/db-paths';
import { SidecarStore } from '../../accounts/sidecar-store';
import { emitGuardRecordDropped } from './cache-events';

const LEGACY_FILE = 'steam-guard.json';

export interface GuardRecord {
  /** Market item id, or the negative id of a hand-added account. */
  readonly accountId: number;
  readonly steamId: string;
  readonly accountName: string;
  /** Long-lived MobileApp token; access tokens are minted from it on demand. */
  readonly refreshToken: string;
  /** TOTP secret. Kept here so codes survive a restart without a network round trip. */
  readonly sharedSecret: string | null;
  /** Signs confirmations. */
  readonly identitySecret: string | null;
  /** `android:<uuid>`; must not change or Steam returns an empty confirmation list. */
  readonly deviceId: string;
  /** Proxy the account was linked through; token refreshes must take the same route. */
  readonly proxyId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Fields a caller may set; the store owns the timestamps and the id. */
export type GuardRecordInput = Omit<GuardRecord, 'createdAt' | 'updatedAt'>;

const asString = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const asInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

const parseRecord = (v: unknown, accountId: number): GuardRecord | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const steamId = asString(r.steamId);
  const refreshToken = asString(r.refreshToken);
  const deviceId = asString(r.deviceId);
  if (!steamId || !refreshToken || !deviceId) return null;

  const now = Date.now();
  const createdAt = asInt(r.createdAt) ?? now;
  return {
    // Where the file sits wins over what it says.
    accountId,
    steamId,
    accountName: asString(r.accountName) ?? '',
    refreshToken,
    sharedSecret: asString(r.sharedSecret),
    identitySecret: asString(r.identitySecret),
    deviceId,
    proxyId: asString(r.proxyId),
    createdAt,
    updatedAt: asInt(r.updatedAt) ?? createdAt,
  };
};

const store = new SidecarStore<GuardRecord>({
  service: 'steam',
  file: GUARD_FILE,
  tag: '[steam-guard]',
  parse: parseRecord,
});

/** Import of the single encrypted file this store used to be; runs at most once. */
let legacyRun: Promise<void> | null = null;

const migrateLegacy = (): Promise<void> => {
  legacyRun ??= runLegacyMigration();
  return legacyRun;
};

const runLegacyMigration = async (): Promise<void> => {
  const path = join(app.getPath('userData'), LEGACY_FILE);
  if (!(await pathExists(path))) return;

  let list: unknown[];
  try {
    const buf = await fs.readFile(path);
    let text: string;
    if (safeStorage.isEncryptionAvailable()) {
      try {
        text = safeStorage.decryptString(buf);
      } catch {
        text = buf.toString('utf8');
      }
    } else {
      text = buf.toString('utf8');
    }
    const parsed = JSON.parse(text) as { records?: unknown };
    if (!Array.isArray(parsed?.records)) throw new Error('no record list');
    list = parsed.records;
  } catch (err) {
    // A file we cannot read may still be readable on the machine that wrote it, so it is left exactly as it is.
    log.error(`[steam-guard] legacy store at ${path} could not be read`, err);
    return;
  }

  let imported = 0;
  let lost = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const accountId = asInt((item as Record<string, unknown>).accountId);
    if (accountId === null) continue;
    const record = parseRecord(item, accountId);
    if (!record) continue;
    // Only accounts the folders do not already hold, so a second run is a no-op.
    if (await store.get(accountId)) continue;
    if (await store.save(accountId, () => record)) imported++;
    else lost++;
  }

  log.info(`[steam-guard] migrated ${imported} record(s) from ${path}`);
  if (lost > 0) {
    // Renaming now would leave those authenticators in a file nothing reads again.
    log.error(`[steam-guard] ${lost} record(s) did not land; keeping ${path}`);
    return;
  }

  try {
    await fs.rename(path, `${path}.migrated-${Date.now()}`);
  } catch (err) {
    log.error('[steam-guard] failed to rename the legacy store', err);
  }
};

export const listGuardRecords = async (): Promise<GuardRecord[]> => {
  await migrateLegacy();
  return store.list();
};

export const getGuardRecord = async (accountId: number): Promise<GuardRecord | null> => {
  await migrateLegacy();
  return store.get(accountId);
};

/** Inserts or replaces in one pass, preserving `createdAt` across a re-link. */
export const saveGuardRecord = async (value: GuardRecordInput): Promise<boolean> => {
  await migrateLegacy();
  const now = Date.now();
  const saved = await store.save(value.accountId, (previous) => ({
    ...value,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }));
  // A re-link replaces the refresh token, and everything minted from the old one is now about a session Steam has already.
  if (saved) emitGuardRecordDropped(value.accountId);
  return saved;
};

export const deleteGuardRecord = async (accountId: number): Promise<boolean> => {
  // Before the removal, not after: a legacy import that runs later would put back the very record the user has just deleted.
  await migrateLegacy();
  const removed = await store.remove(accountId);
  // Unconditionally, not only on success: the record is gone from the caller's point of view either way.
  emitGuardRecordDropped(accountId);
  return removed;
};

export const resetGuardStoreForTests = (): void => {
  legacyRun = null;
  store.resetForTests();
};

import { readFile, writeFile } from 'node:fs/promises';
import { DC_MAPPING_PROD } from '@mtcute/convert';
import type { PyrogramSession, TelethonSession } from '@mtcute/convert';
import type initSqlJs from 'sql.js/dist/sql-asm.js';

type SqlJsStatic = initSqlJs.SqlJsStatic;
type SqlDatabase = initSqlJs.Database;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

const loadSqlJs = (): Promise<SqlJsStatic> => {
  if (!sqlJsPromise) {
    sqlJsPromise = import('sql.js/dist/sql-asm.js').then((mod) => mod.default());
  }
  return sqlJsPromise;
};

const withDb = async <T>(bytes: Uint8Array | null, fn: (db: SqlDatabase) => T): Promise<T> => {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(bytes);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

const columnsOf = (db: SqlDatabase, table: string): Set<string> => {
  const res = db.exec(`PRAGMA table_info(${JSON.stringify(table)})`);
  const rows = res[0]?.values ?? [];
  // PRAGMA table_info yields (cid, name, type, notnull, dflt_value, pk).
  return new Set(rows.map((row) => String(row[1])));
};

const firstRow = (db: SqlDatabase, sql: string): Record<string, unknown> | null => {
  const res = db.exec(sql);
  const result = res[0];
  const values = result?.values[0];
  if (!result || !values) return null;
  const out: Record<string, unknown> = {};
  result.columns.forEach((col, i) => {
    out[col] = values[i];
  });
  return out;
};

const asAuthKey = (value: unknown): Uint8Array => {
  if (!(value instanceof Uint8Array)) throw new Error('в таблице sessions нет auth_key');
  // Telethon stores a missing key as an empty blob rather than NULL.
  if (value.length !== 256) {
    throw new Error(`auth_key должен быть 256 байт, в файле ${value.length}`);
  }
  return value;
};

const asInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
};

const requireProdDc = (dcId: number | null): number => {
  if (dcId === null || !DC_MAPPING_PROD[dcId]) throw new Error(`Неизвестный DC id: ${dcId}`);
  return dcId;
};

export type SessionFileFlavor = 'telethon' | 'pyrogram';

export type SessionFile =
  | { readonly flavor: 'telethon'; readonly session: TelethonSession }
  | { readonly flavor: 'pyrogram'; readonly session: PyrogramSession };

/** Which client wrote this file, decided by the shape of its `sessions` table. */
const flavorOf = (db: SqlDatabase): SessionFileFlavor => {
  const cols = columnsOf(db, 'sessions');
  if (cols.size === 0) throw new Error('в файле нет таблицы sessions');
  if (cols.has('server_address')) return 'telethon';
  if (cols.has('test_mode') || cols.has('api_id')) return 'pyrogram';
  throw new Error('таблица sessions незнакомого вида');
};

const readTelethon = (db: SqlDatabase): TelethonSession => {
  const row = firstRow(db, 'SELECT dc_id, server_address, port, auth_key FROM sessions LIMIT 1');
  if (!row) throw new Error('таблица sessions пуста');
  const dcId = requireProdDc(asInt(row.dc_id));
  const fallback = DC_MAPPING_PROD[dcId]?.main;
  const address =
    typeof row.server_address === 'string' && row.server_address
      ? row.server_address
      : (fallback?.ipAddress ?? '');
  if (!address) throw new Error('в файле нет адреса DC');
  return {
    dcId,
    ipAddress: address,
    ipv6: address.includes(':'),
    port: asInt(row.port) ?? fallback?.port ?? 443,
    authKey: asAuthKey(row.auth_key),
  };
};

const readPyrogram = (db: SqlDatabase): PyrogramSession => {
  const cols = columnsOf(db, 'sessions');
  const wanted = ['dc_id', 'api_id', 'test_mode', 'auth_key', 'user_id', 'is_bot'].filter((c) =>
    cols.has(c),
  );
  const row = firstRow(db, `SELECT ${wanted.join(', ')} FROM sessions LIMIT 1`);
  if (!row) throw new Error('таблица sessions пуста');
  const apiId = asInt(row.api_id);
  return {
    dcId: requireProdDc(asInt(row.dc_id)),
    isTest: Boolean(asInt(row.test_mode)),
    authKey: asAuthKey(row.auth_key),
    userId: asInt(row.user_id) ?? 0,
    isBot: Boolean(asInt(row.is_bot)),
    ...(apiId !== null && apiId > 0 ? { apiId } : {}),
  };
};

/** Reads either flavour of `.session`, deciding which by the table shape. */
export const readSessionFile = async (path: string): Promise<SessionFile> => {
  const bytes = await readFile(path);
  return withDb(bytes, (db) => {
    const flavor = flavorOf(db);
    return flavor === 'telethon'
      ? { flavor, session: readTelethon(db) }
      : { flavor, session: readPyrogram(db) };
  });
};

/** True when the file is a SQLite database at all — cheap pre-filter for scans. */
export const looksLikeSqlite = (head: Uint8Array): boolean => {
  const magic = 'SQLite format 3\0';
  if (head.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (head[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
};

/** Telethon's schema, written at version 7 rather than its current 8. */
const TELETHON_SCHEMA = [
  'CREATE TABLE version (version integer primary key)',
  'CREATE TABLE sessions (dc_id integer primary key, server_address text, port integer, auth_key blob, takeout_id integer)',
  'CREATE TABLE entities (id integer primary key, hash integer not null, username text, phone integer, name text, date integer)',
  'CREATE TABLE sent_files (md5_digest blob, file_size integer, type integer, id integer, hash integer, primary key(md5_digest, file_size, type))',
  'CREATE TABLE update_state (id integer primary key, pts integer, qts integer, date integer, seq integer)',
];
const TELETHON_VERSION = 7;

export const writeTelethonSessionFile = async (
  path: string,
  session: TelethonSession,
): Promise<void> => {
  const bytes = await withDb(null, (db) => {
    for (const stmt of TELETHON_SCHEMA) db.run(stmt);
    db.run('INSERT INTO version VALUES (?)', [TELETHON_VERSION]);
    db.run('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)', [
      session.dcId,
      session.ipAddress,
      session.port,
      session.authKey,
      null,
    ]);
    return db.export();
  });
  await writeFile(path, bytes);
};

/** Pyrogram's schema, verbatim from `pyrogram/storage/sqlite_storage.py`. */
const PYROGRAM_SCHEMA = [
  'CREATE TABLE sessions (dc_id INTEGER PRIMARY KEY, api_id INTEGER, test_mode INTEGER, auth_key BLOB, date INTEGER NOT NULL, user_id INTEGER, is_bot INTEGER)',
  "CREATE TABLE peers (id INTEGER PRIMARY KEY, access_hash INTEGER, type TEXT NOT NULL, username TEXT, phone_number TEXT, last_update_on INTEGER NOT NULL DEFAULT (CAST(STRFTIME('%s', 'now') AS INTEGER)))",
  'CREATE TABLE version (number INTEGER PRIMARY KEY)',
  'CREATE INDEX idx_peers_id ON peers (id)',
  'CREATE INDEX idx_peers_username ON peers (username)',
  'CREATE INDEX idx_peers_phone_number ON peers (phone_number)',
  "CREATE TRIGGER trg_peers_last_update_on AFTER UPDATE ON peers BEGIN UPDATE peers SET last_update_on = CAST(STRFTIME('%s', 'now') AS INTEGER) WHERE id = NEW.id; END",
];
const PYROGRAM_VERSION = 3;

export const writePyrogramSessionFile = async (
  path: string,
  session: PyrogramSession,
  date = Math.floor(Date.now() / 1000),
): Promise<void> => {
  const bytes = await withDb(null, (db) => {
    for (const stmt of PYROGRAM_SCHEMA) db.run(stmt);
    db.run('INSERT INTO version VALUES (?)', [PYROGRAM_VERSION]);
    db.run('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)', [
      session.dcId,
      session.apiId ?? null,
      session.isTest ? 1 : 0,
      session.authKey,
      date,
      session.userId,
      session.isBot ? 1 : 0,
    ]);
    return db.export();
  });
  await writeFile(path, bytes);
};

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import {
  Tdata,
  convertFromGramjsSession,
  convertFromMtkrutoSession,
  convertFromPyrogramSession,
  convertFromTdata,
  convertFromTelethonSession,
  convertToGramjsSession,
  convertToMtkrutoSession,
  convertToPyrogramSession,
  convertToTdata,
  convertToTelethonSession,
} from '@mtcute/convert';
import type { StringSessionData } from '@mtcute/node/utils.js';
import { readStringSession, writeStringSession } from '@mtcute/node/utils.js';
import type {
  TelegramConvertEntry,
  TelegramConvertItemResult,
  TelegramConvertProblem,
  TelegramConvertRunResult,
  TelegramConvertScan,
  TelegramConvertTarget,
  TelegramSessionFormat,
} from '@shared-types';
import type { TelegramSidecar } from './session-json';
import {
  mergeSidecar,
  parseTelegramSidecarJson,
  serializeTelegramSidecar,
  tdesktopSidecarDefaults,
} from './session-json';
import {
  looksLikeSqlite,
  readSessionFile,
  writePyrogramSessionFile,
  writeTelethonSessionFile,
} from './session-sqlite';

const MAX_DEPTH = 4;
const SESSION_EXTS = new Set(['.session', '.dat', '.db']);
const TEXT_EXTS = new Set(['.txt', '.session_string', '.string']);
const STRING_TARGETS = new Set<TelegramConvertTarget>([
  'telethon-string',
  'gramjs-string',
  'pyrogram-string',
  'mtkruto-string',
  'mtcute-string',
]);

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const readFileSafe = async (path: string): Promise<Uint8Array | null> => {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
};

const readTextSafe = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
};

const isFilePath = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- string sessions

/** Reject a parse that produced something Telegram would never accept. */
const validate = (session: StringSessionData | null | undefined): StringSessionData | null => {
  const dc = session?.primaryDcs?.main;
  if (!session || !dc) return null;
  if (!Number.isInteger(dc.id) || dc.id < 1 || dc.id > 5) return null;
  if (session.authKey?.length !== 256) return null;
  return session;
};

const tryParse = (fn: () => StringSessionData): StringSessionData | null => {
  try {
    return validate(fn());
  } catch {
    return null;
  }
};

/** Every one-line format, each paired with the encoder that reproduces it. */
const STRING_CANDIDATES: readonly {
  readonly format: TelegramSessionFormat;
  readonly parse: (text: string) => StringSessionData;
  readonly encode: (session: StringSessionData) => string;
}[] = [
  {
    format: 'telethon-string',
    parse: convertFromTelethonSession,
    encode: convertToTelethonSession,
  },
  { format: 'gramjs-string', parse: convertFromGramjsSession, encode: convertToGramjsSession },
  { format: 'mtkruto-string', parse: convertFromMtkrutoSession, encode: convertToMtkrutoSession },
  {
    format: 'pyrogram-string',
    parse: convertFromPyrogramSession,
    encode: (s) => convertToPyrogramSession(s),
  },
  { format: 'mtcute-string', parse: readStringSession, encode: writeStringSession },
];

/** Works out which client wrote a one-line session string. */
export const parseAnyStringSession = (
  raw: string,
): { format: TelegramSessionFormat; session: StringSessionData } | null => {
  const text = raw.trim();
  if (!text) return null;

  const guesses: { format: TelegramSessionFormat; session: StringSessionData }[] = [];
  for (const candidate of STRING_CANDIDATES) {
    const session = tryParse(() => candidate.parse(text));
    if (!session) continue;
    let encoded: string | null = null;
    try {
      encoded = candidate.encode(session);
    } catch {
      encoded = null;
    }
    if (encoded === text) return { format: candidate.format, session };
    guesses.push({ format: candidate.format, session });
  }
  return guesses[0] ?? null;
};

// ---------------------------------------------------------------- scanning

/** One convertible thing found on disk. */
interface ScanItem {
  readonly id: string;
  readonly path: string;
  readonly name: string;
  readonly format: TelegramSessionFormat;
  /** Account index inside a multi-account tdata. */
  readonly tdataIndex?: number;
  /** Line number (1-based) inside a `.txt` of string sessions. */
  readonly line?: number;
  /** Sidecar `.json` discovered next to this item. */
  readonly metaPath?: string;
}

/** What the last scan of each folder found. */
const scanCache = new Map<string, ScanItem[]>();

interface FoundOnDisk {
  readonly tdataDirs: string[];
  readonly files: string[];
  skipped: number;
}

const readdirSafe = async (dir: string) => {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
};

/** `key_datas` is the one file every tdata has and nothing else does. */
const walk = async (dir: string, depth: number, acc: FoundOnDisk): Promise<void> => {
  const items = await readdirSafe(dir);
  if (!items) return;

  if (items.some((item) => item.isFile() && item.name === 'key_datas')) {
    acc.tdataDirs.push(dir);
    return;
  }

  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      if (depth < MAX_DEPTH) await walk(full, depth + 1, acc);
      else acc.skipped++;
    } else if (item.isFile()) {
      acc.files.push(full);
    }
  }
};

const withoutExt = (path: string): string => path.slice(0, path.length - extname(path).length);

const maybeMeta = (metaPath: string | undefined) => (metaPath ? { metaPath } : {});

const toEntry = (
  item: ScanItem,
  session: StringSessionData | null,
  meta: TelegramSidecar | null,
  problem: TelegramConvertProblem | null,
  detail: string | null,
): TelegramConvertEntry => ({
  id: item.id,
  path: item.path,
  name: item.name,
  format: item.format,
  dcId: session?.primaryDcs.main.id ?? meta?.dcId ?? null,
  userId: session?.self?.userId ?? meta?.userId ?? null,
  phone: meta?.phone ?? null,
  hasMeta: meta !== null,
  problem,
  problemDetail: detail,
});

/** Reads the folder and reports what is in it, without writing anything. */
export const scanConvertFolder = async (dir: string): Promise<TelegramConvertScan> => {
  const acc: FoundOnDisk = { tdataDirs: [], files: [], skipped: 0 };
  const single = await isFilePath(dir);
  const root = single ? dirname(dir) : dir;

  if (single) {
    acc.files.push(dir);
    const sidecar = `${withoutExt(dir)}.json`;
    if (sidecar !== dir && (await readFileSafe(sidecar))) acc.files.push(sidecar);
  } else {
    await walk(dir, 0, acc);
  }

  const jsonByStem = new Map<string, string>();
  for (const file of acc.files) {
    if (extname(file).toLowerCase() === '.json') jsonByStem.set(withoutExt(file), file);
  }

  const items: ScanItem[] = [];
  const entries: TelegramConvertEntry[] = [];
  const push = (item: ScanItem, entry: TelegramConvertEntry): void => {
    items.push(item);
    entries.push(entry);
  };
  const rel = (p: string) => relative(root, p) || basename(p);

  for (const tdataDir of acc.tdataDirs) {
    const name = rel(tdataDir);
    try {
      const tdata = await Tdata.open({ path: tdataDir, ignoreVersion: true });
      const order = tdata.keyData.order;
      const indices = order.length > 0 ? order : [0];
      for (const idx of indices) {
        const item: ScanItem = {
          id: `${name}#${idx}`,
          path: tdataDir,
          name: indices.length > 1 ? `${name} #${idx}` : name,
          format: 'tdata',
          tdataIndex: idx,
        };
        try {
          const session = validate(await convertFromTdata(tdata, idx));
          push(
            item,
            session
              ? toEntry(item, session, null, null, null)
              : toEntry(item, null, null, 'bad_auth_key', 'ключ не прошёл проверку'),
          );
        } catch (err) {
          push(item, toEntry(item, null, null, 'unreadable', errText(err)));
        }
      }
    } catch (err) {
      const item: ScanItem = { id: name, path: tdataDir, name, format: 'tdata', tdataIndex: 0 };
      push(item, toEntry(item, null, null, 'unreadable', errText(err)));
    }
  }

  for (const file of acc.files) {
    const ext = extname(file).toLowerCase();
    const name = rel(file);

    // A lone `.json` is metadata; paired ones were picked up via `jsonByStem`.
    if (ext === '.json') {
      acc.skipped++;
      continue;
    }

    const metaPath = jsonByStem.get(withoutExt(file));
    const meta = metaPath ? parseTelegramSidecarJson(await readTextSafe(metaPath)) : null;

    // A picked file is examined whatever it is called; inside a folder only the known extensions are opened.
    if (SESSION_EXTS.has(ext) || (single && !TEXT_EXTS.has(ext))) {
      const bytes = await readFileSafe(file);
      if (!bytes) {
        const item: ScanItem = { id: name, path: file, name, format: 'telethon-session' };
        push(item, toEntry(item, null, meta, 'unreadable', 'файл недоступен'));
        continue;
      }
      if (looksLikeSqlite(bytes)) {
        try {
          const parsed = await readSessionFile(file);
          const format: TelegramSessionFormat =
            parsed.flavor === 'telethon' ? 'telethon-session' : 'pyrogram-session';
          const session = validate(
            parsed.flavor === 'telethon'
              ? convertFromTelethonSession(parsed.session)
              : convertFromPyrogramSession(parsed.session),
          );
          const item: ScanItem = { id: name, path: file, name, format, ...maybeMeta(metaPath) };
          push(
            item,
            session
              ? toEntry(item, session, meta, null, null)
              : toEntry(item, null, meta, 'bad_auth_key', 'ключ не прошёл проверку'),
          );
        } catch (err) {
          const item: ScanItem = {
            id: name,
            path: file,
            name,
            format: 'telethon-session',
            ...maybeMeta(metaPath),
          };
          push(item, toEntry(item, null, meta, 'unreadable', errText(err)));
        }
        continue;
      }
      // Not SQLite — some bases hand out string sessions under a `.session` name.
      const parsed = parseAnyStringSession(new TextDecoder().decode(bytes));
      if (parsed) {
        const item: ScanItem = {
          id: name,
          path: file,
          name,
          format: parsed.format,
          line: 1,
          ...maybeMeta(metaPath),
        };
        push(item, toEntry(item, parsed.session, meta, null, null));
      } else {
        acc.skipped++;
      }
      continue;
    }

    if (TEXT_EXTS.has(ext)) {
      const lines = (await readTextSafe(file)).split(/\r?\n/);
      const single = lines.filter((l) => l.trim()).length === 1;
      let found = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = (lines[i] ?? '').trim();
        if (!line) continue;
        const parsed = parseAnyStringSession(line);
        if (!parsed) {
          acc.skipped++;
          continue;
        }
        found++;
        const item: ScanItem = {
          id: `${name}#${i + 1}`,
          path: file,
          name: single ? name : `${name}:${i + 1}`,
          format: parsed.format,
          line: i + 1,
          ...maybeMeta(single ? metaPath : undefined),
        };
        push(item, toEntry(item, parsed.session, single ? meta : null, null, null));
      }
      if (found === 0) acc.skipped++;
      continue;
    }

    acc.skipped++;
  }

  scanCache.set(dir, items);
  return { dir, entries, skipped: acc.skipped };
};

// ---------------------------------------------------------------- conversion

const loadItem = async (
  item: ScanItem,
): Promise<{ session: StringSessionData; meta: TelegramSidecar | null }> => {
  const meta = item.metaPath ? parseTelegramSidecarJson(await readTextSafe(item.metaPath)) : null;

  if (item.format === 'tdata') {
    const tdata = await Tdata.open({ path: item.path, ignoreVersion: true });
    const session = validate(await convertFromTdata(tdata, item.tdataIndex ?? 0));
    if (!session) throw new Error('в tdata нет пригодного ключа');
    return { session, meta };
  }

  if (item.format === 'telethon-session' || item.format === 'pyrogram-session') {
    const parsed = await readSessionFile(item.path);
    const session = validate(
      parsed.flavor === 'telethon'
        ? convertFromTelethonSession(parsed.session)
        : convertFromPyrogramSession(parsed.session),
    );
    if (!session) throw new Error('в файле нет пригодного ключа');
    return { session, meta };
  }

  const text = await readTextSafe(item.path);
  const parsed = parseAnyStringSession(text.split(/\r?\n/)[(item.line ?? 1) - 1] ?? text);
  if (!parsed) throw new Error('строка сессии больше не читается');
  return { session: parsed.session, meta };
};

/** Fills in what the source container could not hold. */
const enrich = (session: StringSessionData, meta: TelegramSidecar | null): StringSessionData => {
  if (session.self?.userId || !meta?.userId) return session;
  return {
    ...session,
    self: { userId: meta.userId, isBot: false, isPremium: false, usernames: [] },
  };
};

/** Reserved on Windows, plus the control range no filesystem accepts. */
const INVALID_NAME_CHARS = /[<>:"/\\|?*\p{Cc}]/gu;

const safeName = (raw: string): string => {
  const cleaned = raw
    .replace(INVALID_NAME_CHARS, '_')
    .replace(/[.\s]+$/, '')
    .trim();
  return cleaned || 'session';
};

/** Phone first, then user id, then whatever the source file was called. */
const outputName = (
  item: ScanItem,
  session: StringSessionData,
  meta: TelegramSidecar | null,
  used: Set<string>,
): string => {
  const base = safeName(
    meta?.phone?.replace(/^\+/, '') ??
      (session.self?.userId ? String(session.self.userId) : basename(item.name)),
  );
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base}-${i}`;
  used.add(name.toLowerCase());
  return name;
};

const toStringSession = (
  target: TelegramConvertTarget,
  session: StringSessionData,
  apiId: number | null,
): string => {
  switch (target) {
    case 'telethon-string':
      return convertToTelethonSession(session);
    case 'gramjs-string':
      return convertToGramjsSession(session);
    case 'pyrogram-string':
      return apiId
        ? convertToPyrogramSession(session, { apiId })
        : convertToPyrogramSession(session);
    case 'mtkruto-string':
      return convertToMtkrutoSession(session);
    case 'mtcute-string':
      return writeStringSession(session);
    default:
      throw new Error(`Неизвестный строковый формат: ${target}`);
  }
};

export interface ConvertRunParams {
  readonly dir: string;
  readonly ids: readonly string[];
  readonly target: TelegramConvertTarget;
  readonly outDir: string;
  /** Also write the `.json` sidecar next to each converted session. */
  readonly withJson: boolean;
}

/** Fields the session itself supplies, over the tdesktop defaults, over nothing. */
const sidecarFor = (session: StringSessionData, meta: TelegramSidecar | null): TelegramSidecar => {
  const known = mergeSidecar(meta, {
    userId: session.self?.userId ?? null,
    dcId: session.primaryDcs.main.id,
  });
  return mergeSidecar(known, tdesktopSidecarDefaults());
};

const writeOne = async (
  params: ConvertRunParams,
  name: string,
  session: StringSessionData,
  meta: TelegramSidecar | null,
  aggregate: string[],
): Promise<string> => {
  const sidecar = sidecarFor(session, meta);
  const writeSidecar = async (path: string, sessionFile: string): Promise<void> => {
    if (params.withJson)
      await writeFile(path, serializeTelegramSidecar(sidecar, sessionFile), 'utf8');
  };

  if (params.target === 'tdata') {
    const dir = join(params.outDir, name, 'tdata');
    await mkdir(dir, { recursive: true });
    await convertToTdata([session], { path: dir });
    await writeSidecar(join(params.outDir, name, `${name}.json`), 'tdata');
    return dir;
  }

  if (params.target === 'telethon-session' || params.target === 'pyrogram-session') {
    const file = join(params.outDir, `${name}.session`);
    const dc = session.primaryDcs.main;
    if (params.target === 'telethon-session') {
      await writeTelethonSessionFile(file, {
        dcId: dc.id,
        ipAddress: dc.ipAddress,
        ipv6: dc.ipv6 ?? false,
        port: dc.port,
        authKey: session.authKey,
      });
    } else {
      const apiId = meta?.apiId ?? 0;
      await writePyrogramSessionFile(file, {
        dcId: dc.id,
        isTest: dc.testMode ?? false,
        authKey: session.authKey,
        userId: session.self?.userId ?? 0,
        isBot: session.self?.isBot ?? false,
        ...(apiId > 0 ? { apiId } : {}),
      });
    }
    await writeSidecar(join(params.outDir, `${name}.json`), `${name}.session`);
    return file;
  }

  if (!STRING_TARGETS.has(params.target)) {
    throw new Error(`Неизвестный формат: ${params.target}`);
  }

  const encoded = toStringSession(params.target, session, meta?.apiId ?? null);
  const file = join(params.outDir, `${name}.txt`);
  await writeFile(file, `${encoded}\n`, 'utf8');
  aggregate.push(encoded);
  await writeSidecar(join(params.outDir, `${name}.json`), `${name}.txt`);
  return file;
};

const rescan = async (dir: string): Promise<ScanItem[]> => {
  await scanConvertFolder(dir);
  return scanCache.get(dir) ?? [];
};

/** Writes the chosen accounts into `outDir` in the target format. */
export const runConvert = async (params: ConvertRunParams): Promise<TelegramConvertRunResult> => {
  const cached = scanCache.get(params.dir) ?? (await rescan(params.dir));
  const wanted = new Set(params.ids);
  const items = cached.filter((item) => wanted.has(item.id));

  await mkdir(params.outDir, { recursive: true });

  const used = new Set<string>();
  const results: TelegramConvertItemResult[] = [];
  const aggregate: string[] = [];

  for (const item of items) {
    try {
      const loaded = await loadItem(item);
      const session = enrich(loaded.session, loaded.meta);
      const name = outputName(item, session, loaded.meta, used);
      const output = await writeOne(params, name, session, loaded.meta, aggregate);
      results.push({ id: item.id, name: item.name, ok: true, output, error: null });
    } catch (err) {
      results.push({ id: item.id, name: item.name, ok: false, output: null, error: errText(err) });
    }
  }

  if (aggregate.length > 0) {
    await writeFile(join(params.outDir, 'sessions.txt'), `${aggregate.join('\n')}\n`, 'utf8');
  }

  const converted = results.filter((r) => r.ok).length;
  return { outDir: params.outDir, items: results, converted, failed: results.length - converted };
};

// ---------------------------------------------------------------- loading

/** A scanned item with its key read in. */
export interface LoadedTelegramSession {
  readonly id: string;
  readonly name: string;
  readonly format: TelegramSessionFormat;
  readonly session: StringSessionData;
  readonly meta: TelegramSidecar | null;
}

/** Re-opens what a scan found, this time with the keys. */
export const loadScannedSessions = async (
  dir: string,
  ids?: readonly string[],
): Promise<LoadedTelegramSession[]> => {
  const cached = scanCache.get(dir) ?? (await rescan(dir));
  const wanted = ids ? new Set(ids) : null;
  const out: LoadedTelegramSession[] = [];

  for (const item of cached) {
    if (wanted && !wanted.has(item.id)) continue;
    try {
      const loaded = await loadItem(item);
      out.push({
        id: item.id,
        name: item.name,
        format: item.format,
        session: enrich(loaded.session, loaded.meta),
        meta: loaded.meta,
      });
    } catch {
      // Already reported as a problem by the scan this list came from.
    }
  }
  return out;
};

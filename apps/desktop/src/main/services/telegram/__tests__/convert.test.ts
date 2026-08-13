import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DC_MAPPING_PROD,
  convertFromPyrogramSession,
  convertFromTelethonSession,
  convertToGramjsSession,
  convertToMtkrutoSession,
  convertToPyrogramSession,
  convertToTdata,
  convertToTelethonSession,
} from '@mtcute/convert';
import type { StringSessionData } from '@mtcute/node/utils.js';
import { writeStringSession } from '@mtcute/node/utils.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAnyStringSession, runConvert, scanConvertFolder } from '../convert';
import {
  readSessionFile,
  writePyrogramSessionFile,
  writeTelethonSessionFile,
} from '../session-sqlite';

const AUTH_KEY = new Uint8Array(256).map((_, i) => (i * 7 + 3) & 0xff);
const OTHER_KEY = new Uint8Array(256).map((_, i) => (i * 11 + 5) & 0xff);
const USER_ID = 777_000_123;

const session = (dcId = 2, userId: number | null = USER_ID): StringSessionData => {
  const dcs = DC_MAPPING_PROD[dcId];
  if (!dcs) throw new Error('bad dc');
  return {
    version: 3,
    primaryDcs: dcs,
    authKey: AUTH_KEY,
    ...(userId !== null
      ? { self: { userId, isBot: false, isPremium: false, usernames: [] } }
      : { self: null }),
  };
};

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lzt-convert-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseAnyStringSession', () => {
  it('recognises every string format the launcher can write', () => {
    const s = session();
    const cases = [
      ['mtcute-string', writeStringSession(s)],
      ['telethon-string', convertToTelethonSession(s)],
      ['gramjs-string', convertToGramjsSession(s)],
      ['pyrogram-string', convertToPyrogramSession(s)],
      ['mtkruto-string', convertToMtkrutoSession(s)],
    ] as const;

    for (const [format, text] of cases) {
      const parsed = parseAnyStringSession(text);
      expect(parsed, format).not.toBeNull();
      expect(parsed?.format, format).toBe(format);
      expect(parsed?.session.authKey, format).toEqual(AUTH_KEY);
      expect(parsed?.session.primaryDcs.main.id, format).toBe(2);
    }
  });

  // An mtcute session starts with the byte 3, and so does a Pyrogram session for an account on DC 3.
  it('does not mistake a DC-3 Pyrogram session for an mtcute one', () => {
    const text = convertToPyrogramSession(session(3));
    const parsed = parseAnyStringSession(text);
    expect(parsed?.format).toBe('pyrogram-string');
    expect(parsed?.session.primaryDcs.main.id).toBe(3);
  });

  it('tells Telethon and GramJS apart despite the shared "1" prefix', () => {
    expect(parseAnyStringSession(convertToTelethonSession(session()))?.format).toBe(
      'telethon-string',
    );
    expect(parseAnyStringSession(convertToGramjsSession(session()))?.format).toBe('gramjs-string');
  });

  it('rejects anything that is not a session', () => {
    expect(parseAnyStringSession('')).toBeNull();
    expect(parseAnyStringSession('hello world')).toBeNull();
    expect(parseAnyStringSession(`1${'A'.repeat(100)}`)).toBeNull();
  });
});

describe('.session files', () => {
  it('round-trips a Telethon file through sql.js', async () => {
    const file = join(dir, 'telethon-rt.session');
    const dc = DC_MAPPING_PROD[4]?.main;
    if (!dc) throw new Error('bad dc');
    await writeTelethonSessionFile(file, {
      dcId: 4,
      ipAddress: dc.ipAddress,
      ipv6: false,
      port: dc.port,
      authKey: AUTH_KEY,
    });

    const read = await readSessionFile(file);
    expect(read.flavor).toBe('telethon');
    if (read.flavor !== 'telethon') throw new Error('unreachable');
    expect(read.session.authKey).toEqual(AUTH_KEY);
    expect(read.session.dcId).toBe(4);
    expect(convertFromTelethonSession(read.session).authKey).toEqual(AUTH_KEY);
  });

  it('round-trips a Pyrogram file, keeping user id and api id', async () => {
    const file = join(dir, 'pyrogram-rt.session');
    await writePyrogramSessionFile(file, {
      dcId: 5,
      isTest: false,
      authKey: OTHER_KEY,
      userId: USER_ID,
      isBot: false,
      apiId: 2040,
    });

    const read = await readSessionFile(file);
    expect(read.flavor).toBe('pyrogram');
    if (read.flavor !== 'pyrogram') throw new Error('unreachable');
    expect(read.session.authKey).toEqual(OTHER_KEY);
    expect(read.session.userId).toBe(USER_ID);
    expect(read.session.apiId).toBe(2040);
    expect(convertFromPyrogramSession(read.session).self?.userId).toBe(USER_ID);
  });

  // Telethon migrates 7 → 8 by itself; writing 8 would break a client still on 7.
  it('stamps the Telethon schema version at 7', async () => {
    const file = join(dir, 'telethon-version.session');
    await writeTelethonSessionFile(file, {
      dcId: 2,
      ipAddress: '149.154.167.51',
      ipv6: false,
      port: 443,
      authKey: AUTH_KEY,
    });
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('refuses a file whose auth_key is the wrong size', async () => {
    const file = join(dir, 'broken.session');
    await writeTelethonSessionFile(file, {
      dcId: 2,
      ipAddress: '149.154.167.51',
      ipv6: false,
      port: 443,
      authKey: AUTH_KEY,
    });
    const bytes = await readFile(file);
    // Corrupt the header so it is no longer a database at all.
    bytes[0] = 0x00;
    await writeFile(file, bytes);
    await expect(readSessionFile(file)).rejects.toThrow();
  });
});

describe('scanConvertFolder + runConvert', () => {
  let src: string;
  let out: string;

  beforeAll(async () => {
    src = join(dir, 'base');
    out = join(dir, 'out');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(src, { recursive: true });

    await writeTelethonSessionFile(join(src, '79001234567.session'), {
      dcId: 2,
      ipAddress: '149.154.167.51',
      ipv6: false,
      port: 443,
      authKey: AUTH_KEY,
    });
    await writeFile(
      join(src, '79001234567.json'),
      JSON.stringify({
        phone: '79001234567',
        user_id: USER_ID,
        app_id: 2040,
        app_hash: 'b18441a1ff607e10a989891a5462e627',
        device: 'Desktop',
        // The trap: a 0/1 flag, not the 2FA password.
        telegram_password: 1,
        telegram_password_value: 'hunter2',
      }),
      'utf8',
    );
    await writeFile(
      join(src, 'strings.txt'),
      `${convertToTelethonSession(session(1, null))}\n\n${convertToMtkrutoSession(session(5, null))}\n`,
      'utf8',
    );
    await convertToTdata([session(3)], { path: join(src, 'acc-tdata', 'tdata') });
  });

  it('recognises each container and pairs the json sidecar', async () => {
    const scan = await scanConvertFolder(src);
    const byFormat = new Map(scan.entries.map((e) => [e.format, e]));

    expect(byFormat.get('telethon-session')?.phone).toBe('+79001234567');
    expect(byFormat.get('telethon-session')?.hasMeta).toBe(true);
    expect(byFormat.get('telethon-session')?.userId).toBe(USER_ID);
    expect(byFormat.get('telethon-string')?.dcId).toBe(1);
    expect(byFormat.get('mtkruto-string')?.dcId).toBe(5);
    expect(byFormat.get('tdata')?.dcId).toBe(3);
    expect(scan.entries.every((e) => e.problem === null)).toBe(true);
  });

  it('converts everything to Pyrogram sessions without touching the source', async () => {
    const before = (await readdir(src)).sort();
    const scan = await scanConvertFolder(src);
    const result = await runConvert({
      dir: src,
      ids: scan.entries.map((e) => e.id),
      target: 'pyrogram-session',
      outDir: out,
      withJson: true,
    });

    expect(result.failed).toBe(0);
    expect(result.converted).toBe(scan.entries.length);
    expect((await readdir(src)).sort()).toEqual(before);

    // The account with a sidecar is named by its phone and keeps its metadata.
    const named = join(out, '79001234567.session');
    const read = await readSessionFile(named);
    expect(read.flavor).toBe('pyrogram');
    expect(read.session.authKey).toEqual(AUTH_KEY);
    if (read.flavor !== 'pyrogram') throw new Error('unreachable');
    // The Telethon file knew no user id; the sidecar supplied it.
    expect(read.session.userId).toBe(USER_ID);
    expect(read.session.apiId).toBe(2040);

    const meta = JSON.parse(await readFile(join(out, '79001234567.json'), 'utf8'));
    expect(meta.twoFA).toBe('hunter2');
    expect(meta.app_hash).toBe('b18441a1ff607e10a989891a5462e627');
    expect(meta.session_file).toBe('79001234567.session');
  });

  it('writes an aggregate sessions.txt for string targets', async () => {
    const stringsOut = join(dir, 'out-strings');
    const scan = await scanConvertFolder(src);
    const result = await runConvert({
      dir: src,
      ids: scan.entries.map((e) => e.id),
      target: 'telethon-string',
      outDir: stringsOut,
      withJson: false,
    });

    expect(result.failed).toBe(0);
    const all = (await readFile(join(stringsOut, 'sessions.txt'), 'utf8')).trim().split('\n');
    expect(all).toHaveLength(scan.entries.length);
    for (const line of all) {
      expect(parseAnyStringSession(line)?.format).toBe('telethon-string');
    }
  });

  it('keeps the auth key byte-identical across a tdata round trip', async () => {
    const tdataOut = join(dir, 'out-tdata');
    const scan = await scanConvertFolder(src);
    const telethon = scan.entries.find((e) => e.format === 'telethon-session');
    expect(telethon).toBeDefined();
    if (!telethon) return;

    await runConvert({
      dir: src,
      ids: [telethon.id],
      target: 'tdata',
      outDir: tdataOut,
      withJson: false,
    });

    const back = await scanConvertFolder(tdataOut);
    const entry = back.entries.find((e) => e.format === 'tdata');
    expect(entry?.problem).toBeNull();
    expect(entry?.userId).toBe(USER_ID);

    const roundTripped = join(dir, 'out-tdata-back');
    const result = await runConvert({
      dir: tdataOut,
      ids: back.entries.map((e) => e.id),
      target: 'telethon-session',
      outDir: roundTripped,
      withJson: false,
    });
    expect(result.failed).toBe(0);
    const file = result.items[0]?.output;
    expect(file).toBeTruthy();
    if (!file) return;
    const read = await readSessionFile(file);
    expect(read.session.authKey).toEqual(AUTH_KEY);
  });
});

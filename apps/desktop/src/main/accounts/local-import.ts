import type {
  LocalAccountRecord,
  LocalImportFile,
  LocalImportGroups,
  LocalImportRequest,
  LocalImportRow,
  LocalServiceId,
} from '@shared-types';
import { extractAccountName } from '../adapters/steam/mafile';
import {
  type ValidatedLocalAccount,
  parseAuthKeyInput,
  parseSteamGuard,
  validateLocalAccount,
} from './local-validate';

/** Guards against a drop that would blow up the IPC message. */
export const MAX_FILES = 2000;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_LINES = 5000;

/** A record that passed validation, plus the row shown for it in the report. */
export interface PlannedRecord {
  readonly row: LocalImportRow;
  /** Carries the password / secret / key — never leaves the main process. */
  readonly value: ValidatedLocalAccount;
}

export interface ImportPlan {
  readonly service: LocalServiceId;
  readonly matched: PlannedRecord[];
  /** Steam only: credentials with no maFile, created only if the user opts in. */
  readonly missingGuard: PlannedRecord[];
  /** The same plan with every secret stripped — this is what the renderer sees. */
  readonly groups: LocalImportGroups;
}

const emptyGroups = (): LocalImportGroups => ({
  matched: [],
  missingGuard: [],
  orphanFiles: [],
  duplicates: [],
  invalid: [],
});

/** Steam logins are case-insensitive, so matching has to be too. */
const key = (login: string): string => login.trim().toLowerCase();

const lines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));

export interface ParsedCredential {
  readonly login: string;
  readonly password: string;
}

/** `login:pass`, `login;pass` or `login<whitespace>pass`. */
export const parseCredentialLine = (line: string): ParsedCredential | null => {
  const at = line.search(/[:;\s\t]/);
  if (at <= 0) return null;
  const login = line.slice(0, at).trim();
  const password = line.slice(at + 1).trim();
  if (!login || !password) return null;
  return { login, password };
};

export interface ParsedMafile {
  readonly accountName: string;
  /** The file, whole, as it will be handed to the form's guard field. */
  readonly text: string;
  readonly source: string;
}

export interface ParsedMafiles {
  readonly parsed: ParsedMafile[];
  readonly invalid: LocalImportRow[];
}

/** Reads what bulk import needs out of each dropped file. */
export const parseMafiles = (files: readonly LocalImportFile[]): ParsedMafiles => {
  const parsed: ParsedMafile[] = [];
  const invalid: LocalImportRow[] = [];
  const seen = new Set<string>();

  for (const file of files.slice(0, MAX_FILES)) {
    const source = file.name;
    if (file.text.length > MAX_FILE_BYTES) {
      invalid.push({ title: source, source, reason: 'file_too_big' });
      continue;
    }
    const accountName = extractAccountName(file.text)?.trim() ?? '';
    // Parsed only to reject a file that carries no usable secret; what gets kept is the text.
    if (!parseSteamGuard(file.text)) {
      invalid.push({ title: source, source, reason: 'no_secret' });
      continue;
    }
    if (!accountName) {
      invalid.push({ title: source, source, reason: 'no_account_name' });
      continue;
    }
    if (seen.has(key(accountName))) {
      invalid.push({ title: accountName, source, reason: 'duplicate_input' });
      continue;
    }
    seen.add(key(accountName));
    parsed.push({ accountName, text: file.text, source });
  }

  for (const file of files.slice(MAX_FILES)) {
    invalid.push({ title: file.name, source: file.name, reason: 'limit' });
  }
  return { parsed, invalid };
};

const buildSteamPlan = (
  request: LocalImportRequest,
  existing: readonly LocalAccountRecord[],
): ImportPlan => {
  const groups = emptyGroups();
  const matched: PlannedRecord[] = [];
  const missingGuard: PlannedRecord[] = [];

  const { parsed, invalid } = parseMafiles(request.files ?? []);
  groups.invalid.push(...invalid);

  const byLogin = new Map(parsed.map((m) => [key(m.accountName), m]));
  const used = new Set<string>();

  const known = new Set(existing.flatMap((r) => (r.service === 'steam' ? [key(r.login)] : [])));
  const seenLines = new Set<string>();

  const all = lines(request.text ?? '');
  for (const line of all.slice(0, MAX_LINES)) {
    const cred = parseCredentialLine(line);
    if (!cred) {
      groups.invalid.push({ title: line.slice(0, 64), reason: 'bad_line' });
      continue;
    }
    const k = key(cred.login);
    if (seenLines.has(k)) {
      groups.duplicates.push({ title: cred.login, reason: 'duplicate_input' });
      continue;
    }
    seenLines.add(k);
    if (known.has(k)) {
      groups.duplicates.push({ title: cred.login, reason: 'already_stored' });
      continue;
    }

    const mafile = byLogin.get(k);
    if (mafile) used.add(k);

    const validated = validateLocalAccount({
      service: 'steam',
      label: cred.login,
      login: cred.login,
      password: cred.password,
      guard: mafile?.text ?? '',
    });
    if (!validated.ok) {
      groups.invalid.push({ title: cred.login, source: mafile?.source, reason: validated.message });
      continue;
    }

    const row: LocalImportRow = { title: cred.login, source: mafile?.source };
    if (mafile) {
      matched.push({ row, value: validated.value });
      groups.matched.push(row);
    } else {
      missingGuard.push({ row, value: validated.value });
      groups.missingGuard.push(row);
    }
  }

  for (const line of all.slice(MAX_LINES)) {
    groups.invalid.push({ title: line.slice(0, 64), reason: 'limit' });
  }

  // What is left has a secret but no password, and a password cannot be invented — these can only be reported.
  for (const mafile of parsed) {
    if (used.has(key(mafile.accountName))) continue;
    groups.orphanFiles.push({
      title: mafile.accountName,
      source: mafile.source,
      reason: known.has(key(mafile.accountName)) ? 'already_stored' : 'no_credentials',
    });
  }

  return { service: 'steam', matched, missingGuard, groups };
};

/** `…` plus the tail of the key: enough to tell two rows apart, useless to a thief. */
const authKeyTitle = (hex: string): string => `TG …${hex.slice(-6)}`;

/** A session the main process read off disk, on its way into the same plan as a pasted key. */
export interface ImportedTelegramSession {
  readonly authKeyHex: string;
  readonly dcId: number;
  readonly userId: number | null;
  readonly phone: string | null;
  /** File or folder the session came from, shown as the row's source. */
  readonly name: string;
}

/** One thing to import, whatever it was read from. */
interface TelegramCandidate {
  readonly authKeyHex: string;
  readonly dcId: number | null;
  readonly phone: string;
  readonly userId: string;
  readonly title: string;
  readonly source?: string;
}

/** A container's own metadata is only as good as whoever wrote the sidecar. */
const sessionCandidate = (session: ImportedTelegramSession): TelegramCandidate => {
  const digits = (session.phone ?? '').replace(/\D/g, '');
  const phone = digits.length >= 7 && digits.length <= 15 ? `+${digits}` : '';
  const userId =
    Number.isInteger(session.userId) && (session.userId ?? 0) > 0 ? session.userId : null;
  return {
    authKeyHex: session.authKeyHex.toLowerCase(),
    dcId: session.dcId,
    phone,
    userId: userId === null ? '' : String(userId),
    title: phone || (userId === null ? session.name : `TG ${userId}`),
    source: session.name,
  };
};

const buildTelegramPlan = (
  request: LocalImportRequest,
  existing: readonly LocalAccountRecord[],
  sessions: readonly ImportedTelegramSession[],
): ImportPlan => {
  const groups = emptyGroups();
  const matched: PlannedRecord[] = [];

  const known = new Set(
    existing.flatMap((r) => (r.service === 'telegram' ? [r.authKey.toLowerCase()] : [])),
  );
  const seen = new Set<string>();

  const candidates: TelegramCandidate[] = sessions.map(sessionCandidate);

  const all = lines(request.text ?? '');
  for (const line of all.slice(0, MAX_LINES)) {
    const parsed = parseAuthKeyInput(line);
    if (!parsed) {
      groups.invalid.push({ title: line.slice(0, 24), reason: 'invalid_auth_key' });
      continue;
    }
    candidates.push({
      authKeyHex: parsed.authKeyHex,
      // The key's own `:<dc>` wins; the step's selector covers the bare form.
      dcId: parsed.dcId ?? request.defaultDcId ?? null,
      phone: '',
      userId: '',
      title: authKeyTitle(parsed.authKeyHex),
    });
  }

  for (const candidate of candidates.slice(0, MAX_LINES)) {
    const { title, source } = candidate;
    const row: LocalImportRow = source ? { title, source } : { title };

    if (seen.has(candidate.authKeyHex)) {
      groups.duplicates.push({ ...row, reason: 'duplicate_input' });
      continue;
    }
    seen.add(candidate.authKeyHex);
    if (known.has(candidate.authKeyHex)) {
      groups.duplicates.push({ ...row, reason: 'already_stored' });
      continue;
    }

    const validated = validateLocalAccount({
      service: 'telegram',
      label: title,
      authKey: candidate.authKeyHex,
      dcId: candidate.dcId === null ? '' : String(candidate.dcId),
      phone: candidate.phone,
      userId: candidate.userId,
    });
    if (!validated.ok) {
      groups.invalid.push({ ...row, reason: validated.message });
      continue;
    }

    matched.push({ row, value: validated.value });
    groups.matched.push(row);
  }

  for (const extra of candidates.slice(MAX_LINES)) {
    groups.invalid.push({ title: extra.title, reason: 'limit' });
  }
  for (const line of all.slice(MAX_LINES)) {
    groups.invalid.push({ title: line.slice(0, 24), reason: 'limit' });
  }

  return { service: 'telegram', matched, missingGuard: [], groups };
};

/** `sessions` are the containers main already read for a folder import. */
export const buildImportPlan = (
  request: LocalImportRequest,
  existing: readonly LocalAccountRecord[],
  sessions: readonly ImportedTelegramSession[] = [],
): ImportPlan =>
  request.service === 'steam'
    ? buildSteamPlan(request, existing)
    : buildTelegramPlan(request, existing, sessions);

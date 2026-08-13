import type { LocalServiceId } from './local-account';

/** One dropped file, as the renderer read it. */
export interface LocalImportFile {
  readonly name: string;
  readonly text: string;
}

export interface LocalImportRequest {
  readonly service: LocalServiceId;
  /** Steam: maFile contents. Telegram: unused. */
  readonly files?: readonly LocalImportFile[];
  /** Steam: `login:pass` lines. Telegram: auth_key lines. */
  readonly text?: string;
  /** Telegram: data centre for keys pasted without a `:<dc>` suffix. */
  readonly defaultDcId?: number;
  /** Telegram: a base folder main reads itself — tdata directories, `.session` files, `.txt` of session strings. */
  readonly dir?: string;
}

/** One line of the report. */
export interface LocalImportRow {
  /** Steam login, or `…` plus the tail of a Telegram auth_key. */
  readonly title: string;
  /** File the row came from, when it came from a file. */
  readonly source?: string;
  /** `inventory.localImport.reasons.*` key explaining a rejection. */
  readonly reason?: string;
}

export interface LocalImportGroups {
  /** Ready to create. */
  readonly matched: LocalImportRow[];
  /** Steam: credentials with no maFile — created only if the user opts in. */
  readonly missingGuard: LocalImportRow[];
  /** Steam: maFiles with no credentials — cannot be created, there is no password. */
  readonly orphanFiles: LocalImportRow[];
  /** Already in the database; left untouched. */
  readonly duplicates: LocalImportRow[];
  /** Unparseable input. */
  readonly invalid: LocalImportRow[];
}

export interface LocalImportPreview {
  /** Hands the prepared plan back to `commit` without it passing through the renderer. */
  readonly token: string;
  readonly service: LocalServiceId;
  readonly groups: LocalImportGroups;
}

export type LocalImportPreviewResult =
  | { ok: true; preview: LocalImportPreview }
  | { ok: false; message: string };

export interface LocalImportCommitRequest {
  readonly token: string;
  /** Steam: also create the credentials that had no maFile. */
  readonly includeMissingGuard: boolean;
}

export type LocalImportCommitResult =
  | { ok: true; created: number; failed: LocalImportRow[] }
  | { ok: false; message: string };

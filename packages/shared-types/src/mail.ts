export interface MailLetter {
  id: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: number | null;
  textPlain: string | null;
  textHtml: string | null;
}

/** The mailbox behind a bought account, and nothing else about that account. */
export interface MailCredentials {
  readonly login: string;
  readonly password: string;
}

export interface MailLettersRequest {
  emailPassword?: string;
  email?: string;
  password?: string;
  limit?: number;
}

export type MailLettersResult =
  | { ok: true; letters: MailLetter[] }
  | { ok: false; message: string };

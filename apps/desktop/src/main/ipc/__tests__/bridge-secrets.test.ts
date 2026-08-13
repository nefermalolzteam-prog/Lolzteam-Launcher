import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The one rule of the preload bridge, checked against the source itself. */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Comments are where the *reason* for the rule lives. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const SOURCES = {
  'shared-ipc/channels.ts': '../../../../../../packages/shared-ipc/src/channels.ts',
  'preload/index.ts': '../../../preload/index.ts',
} as const;

/** Types that carry a credential, and so may not be the shape of a channel. */
const FORBIDDEN: readonly (readonly [name: string, pattern: RegExp])[] = [
  // `AccountDetailsProps` is a renderer panel's props and has nothing to do with this.
  ['AccountDetails', /\bAccountDetails\b(?!Props)/],
  ['LocalAccountRecord', /\bLocalAccountRecord\b/],
  ['LocalSteamRecord', /\bLocalSteamRecord\b/],
  ['LocalTelegramRecord', /\bLocalTelegramRecord\b/],
  // Also catches `GuardRecordInput`, which is the same secrets minus two dates.
  ['GuardRecord', /\bGuardRecord/],
];

describe('the preload bridge', () => {
  for (const [name, rel] of Object.entries(SOURCES)) {
    for (const [type, pattern] of FORBIDDEN) {
      it(`does not put ${type} on a channel (${name})`, () => {
        expect(codeOnly(read(rel))).not.toMatch(pattern);
      });
    }
  }

  it('answers the mail page with two strings rather than an account', () => {
    const src = read(SOURCES['preload/index.ts']);
    expect(src).toContain('MailCredentials | null');
  });

  it('answers a deep link with the public fields plus `owned`', () => {
    const src = read(SOURCES['preload/index.ts']);
    expect(src).toContain('AccountPreview | null');
  });

  // The edit form is the one place a stored local account is shown back to the user.
  it('answers the edit form with the non-secret fields', () => {
    const src = read(SOURCES['preload/index.ts']);
    expect(src).toContain('LocalAccountEdit | null');
  });
});

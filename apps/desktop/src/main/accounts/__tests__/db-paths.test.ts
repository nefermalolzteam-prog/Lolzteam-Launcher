import { describe, expect, it, vi } from 'vitest';

// `db-paths` reaches for `app.getPath` only inside `dbRoot`.
vi.mock('electron', () => ({ app: { getPath: () => 'C:/userData' } }));

const { folderName, legacyKind, slugify, uniqueName } = await import('../db-paths');

/** The naming rules of the database, which are the only thing standing between a user-typed label and a folder name. */
describe('slugify', () => {
  it('leaves an ordinary label alone', () => {
    expect(slugify('Main')).toBe('Main');
    expect(slugify('Work (@durov)')).toBe('Work (@durov)');
    expect(slugify('+79001234567')).toBe('+79001234567');
    // Cyrillic is not illegal anywhere we care about.
    expect(slugify('Продажа')).toBe('Продажа');
  });

  it('drops the characters Windows refuses', () => {
    expect(slugify('a/b')).toBe('a b');
    expect(slugify('a\\b')).toBe('a b');
    expect(slugify('a:b')).toBe('a b');
    expect(slugify('a"b<c>d|e?f*g')).toBe('a b c d e f g');
    expect(slugify('a\u0000b')).toBe('a b');
  });

  it('cannot be talked into leaving the folder it was given', () => {
    // The separators are illegal characters, so there is no second segment to climb into.
    expect(slugify('../../etc')).toBe('_.. .. etc');
    expect(slugify('..\\..\\Windows')).toBe('_.. .. Windows');
    // A bare `..` loses its dots to the trailing-dot rule and never reaches it.
    expect(slugify('..')).toBe('account');
    expect(slugify('.')).toBe('account');
  });

  it('pushes a leading dot out of the way', () => {
    // Not because the filesystem minds — because `walkServiceDir` skips every entry starting with `.`.
    expect(slugify('.old')).toBe('_.old');
    expect(slugify('.git')).toBe('_.git');
    expect(slugify('  .hidden  ')).toBe('_.hidden');
  });

  it('pushes reserved device names out of the way, in any case', () => {
    expect(slugify('CON')).toBe('_CON');
    expect(slugify('nul')).toBe('_nul');
    expect(slugify('COM1')).toBe('_COM1');
    expect(slugify('LPT9')).toBe('_LPT9');
    // Only the bare name is reserved.
    expect(slugify('CONSOLE')).toBe('CONSOLE');
    expect(slugify('COM10')).toBe('COM10');
  });

  it('keeps `_market` for the market shelf alone', () => {
    expect(slugify('_market')).toBe('__market');
  });

  it('collapses whitespace and removes what Explorer would drop', () => {
    expect(slugify('  a   b  ')).toBe('a b');
    expect(slugify('name.')).toBe('name');
    expect(slugify('name...  ')).toBe('name');
    expect(slugify('a\tb\nc')).toBe('a b c');
  });

  it('caps the length without leaving a trailing dot behind', () => {
    expect(slugify('x'.repeat(200))).toHaveLength(64);
    // The cut lands mid-run of dots; they must not survive it.
    const cut = slugify(`${'x'.repeat(60)}.....tail`);
    expect(cut).toBe('x'.repeat(60));
  });

  it('always returns something usable', () => {
    expect(slugify('')).toBe('account');
    expect(slugify('   ')).toBe('account');
    expect(slugify('///')).toBe('account');
  });
});

describe('uniqueName', () => {
  const taken = (...names: string[]) => new Set(names.map((n) => n.toLowerCase()));

  it('uses the plain name when it is free', () => {
    expect(uniqueName('Main', '', taken())).toBe('Main');
    expect(uniqueName('Main', '.json', taken('other.json'))).toBe('Main.json');
  });

  it('counts up until it finds a gap', () => {
    expect(uniqueName('Main', '', taken('main'))).toBe('Main (2)');
    expect(uniqueName('Main', '', taken('main', 'main (2)'))).toBe('Main (3)');
    // A gap in the middle is filled rather than skipped.
    expect(uniqueName('Main', '', taken('main', 'main (3)'))).toBe('Main (2)');
  });

  it('treats names case-insensitively, the way Windows does', () => {
    expect(uniqueName('Main', '', taken('MAIN'))).toBe('Main (2)');
  });

  it('puts the counter before the suffix, not after it', () => {
    expect(uniqueName('Main', '.guard.json', taken('main.guard.json'))).toBe('Main (2).guard.json');
  });
});

describe('legacyKind', () => {
  it('sorts the loose files of the pre-folder layout', () => {
    expect(legacyKind('Main.guard.json')).toBe('guard');
    expect(legacyKind('Work.profile.json')).toBe('profile');
    expect(legacyKind('Work.avatar.jpg')).toBe('avatar');
    expect(legacyKind('Main.json')).toBe('account');
  });

  it('is decided by the longest suffix, not the shortest', () => {
    // `.guard.json` also ends with `.json`; guessing "account" here would import an authenticator as if it were an account.
    expect(legacyKind('Main.GUARD.JSON')).toBe('guard');
    expect(legacyKind('Main.Profile.Json')).toBe('profile');
  });

  it('ignores dotfiles and anything that is not ours', () => {
    expect(legacyKind('.DS_Store')).toBeNull();
    expect(legacyKind('.gitignore')).toBeNull();
    expect(legacyKind('notes.txt')).toBeNull();
    expect(legacyKind('avatar.png')).toBeNull();
  });
});

/** Which of the two names an account folder takes. */
describe('folderName', () => {
  it('names a Telegram account after its user id, not its phone', () => {
    expect(folderName({ service: 'telegram', label: '+79001234567', userId: 1234567890 })).toBe(
      '1234567890',
    );
  });

  it('falls back to the label when there is no id to name it after', () => {
    // A pasted auth key: nothing knows the account's id yet, and «TG …a1b2c3» is what the user sees in the list for it.
    expect(folderName({ service: 'telegram', label: 'TG …a1b2c3', userId: null })).toBe(
      'TG …a1b2c3',
    );
    expect(folderName({ service: 'telegram', label: '+79001234567' })).toBe('+79001234567');
  });

  it('leaves every other service on its label', () => {
    expect(folderName({ service: 'steam', label: 'Main', userId: 1234567890 })).toBe('Main');
  });

  it('runs the id through the same name rules as a label', () => {
    // Nothing a Telegram id can contain is illegal, but the guarantee is the point: one function decides folder names.
    expect(folderName({ service: 'telegram', label: 'x', userId: 777000 })).toBe('777000');
  });
});

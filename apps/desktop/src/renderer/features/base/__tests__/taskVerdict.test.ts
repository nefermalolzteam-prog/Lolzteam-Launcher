import type { TelegramCheckInfo, TelegramProfile, TelegramTaskRow } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { profileVerdict, rowVerdict } from '../taskVerdict';

/** The order in which several true things about one account are read. */
const t = ((key: string) => key) as never;

const CHECK: TelegramCheckInfo = {
  status: 'alive',
  userId: 1,
  phone: null,
  username: null,
  name: '',
  premium: false,
  country: null,
  spam: null,
  sessions: null,
  detail: null,
};

const ROW: TelegramTaskRow = {
  accountId: 1,
  state: 'done',
  step: null,
  check: null,
  steam: null,
  filled: null,
  cleaned: null,
  privacy: null,
  friends: null,
  link: null,
  error: null,
  detail: null,
  waitSeconds: null,
};

const row = (patch: Partial<TelegramTaskRow>): TelegramTaskRow => ({ ...ROW, ...patch });

describe('rowVerdict', () => {
  it('reports the run before its result: a row still going says what it is doing', () => {
    const v = rowVerdict(row({ state: 'running', step: 'dialogs' }), t);
    expect(v.label).toBe('base.steps.dialogs');
    expect(v.spin).toBe(true);
  });

  it('names the wait rather than the step while the runner is held back', () => {
    const v = rowVerdict(row({ state: 'running', step: 'waiting', waitSeconds: 30 }), t);
    expect(v.label).toBe('base.status.waiting');
    expect(v.tone).toBe('neutral');
  });

  it('puts a failure above anything the row managed to collect', () => {
    const v = rowVerdict(
      row({
        state: 'failed',
        error: 'flood_wait',
        waitSeconds: 60,
        check: CHECK,
        detail: 'FLOOD_WAIT_60',
      }),
      t,
    );
    expect(v.label).toBe('base.status.floodWait');
    expect(v.tone).toBe('danger');
    expect(v.title).toBe('FLOOD_WAIT_60');
  });

  // What was written, not that the account works.
  it('says what a purge removed rather than that the account is alive', () => {
    const v = rowVerdict(
      row({
        check: CHECK,
        friends: { scanned: 40, removed: 30, blocked: 0, kept: 10, failed: 0 },
      }),
      t,
    );
    expect(v.label).toBe('base.status.friendsRemoved');
    expect(v.tone).toBe('ok');
  });

  it('warns when part of a purge would not go through, and still says how far it got', () => {
    const v = rowVerdict(
      row({ friends: { scanned: 40, removed: 30, blocked: 2, kept: 8, failed: 3 } }),
      t,
    );
    expect(v.label).toBe('base.status.friendsBlocked · base.status.cleanFailed');
    expect(v.tone).toBe('warn');
  });

  it('reads a ban over a successful Steam login', () => {
    const steam = {
      status: 'alive',
      nickname: 'nick',
      vacBanned: true,
      tradeBanState: 'None',
      limited: false,
    } as TelegramTaskRow['steam'];
    expect(rowVerdict(row({ steam }), t).tone).toBe('danger');
  });

  it('says what a cleanup removed, counting everything the user sees go', () => {
    const v = rowVerdict(
      row({
        check: CHECK,
        cleaned: { scanned: 100, left: 10, deleted: 5, contacts: 3, folders: 2, failed: 0 },
      }),
      t,
    );
    expect(v.label).toBe('base.status.cleaned');
    expect(v.tone).toBe('ok');
    expect(v.title).toContain('base.status.cleanedHint');
  });

  // A dead key hands back an empty result; «нечего чистить» over it would answer the wrong question.
  it('lets the verdict through when a cleanup never reached the account', () => {
    const v = rowVerdict(
      row({
        check: { ...CHECK, status: 'dead' },
        cleaned: { scanned: 0, left: 0, deleted: 0, contacts: 0, folders: 0, failed: 0 },
      }),
      t,
    );
    expect(v.label).toBe('base.status.dead');
    expect(v.tone).toBe('danger');
  });

  it('gives a freeze its own tone, neither death nor warning', () => {
    expect(rowVerdict(row({ check: { ...CHECK, status: 'frozen' } }), t).tone).toBe('frozen');
  });

  it('lets a spam block outrank «жив»', () => {
    const v = rowVerdict(row({ check: { ...CHECK, spam: { status: 'blocked', until: null } } }), t);
    expect(v.label).toBe('base.spam.blocked');
    expect(v.tone).toBe('danger');
    expect(v.covers).toBe('spam');
  });

  it('appends the session count to a clean verdict', () => {
    const v = rowVerdict(row({ check: { ...CHECK, sessions: 2 } }), t);
    expect(v.label).toBe('base.status.alive · base.status.sessions');
    expect(v.tone).toBe('ok');
    expect(v.covers).toBe('sessions');
  });

  /** `covers` — это ответ соседней панели (`details/TelegramProfileDetails`) на вопрос. */
  it('covers nothing when «жив» came back without a session count', () => {
    expect(rowVerdict(row({ check: CHECK }), t).covers).toBeNull();
  });

  it('covers nothing when the row is telling about a cleanup instead', () => {
    const v = rowVerdict(
      row({
        check: { ...CHECK, spam: { status: 'blocked', until: null }, sessions: 2 },
        cleaned: { scanned: 100, left: 10, deleted: 0, contacts: 0, folders: 0, failed: 0 },
      }),
      t,
    );
    expect(v.label).toBe('base.status.cleaned');
    expect(v.covers).toBeNull();
  });
});

describe('profileVerdict', () => {
  const PROFILE: TelegramProfile = {
    accountId: 1,
    status: 'alive',
    userId: 1,
    phone: null,
    username: null,
    name: '',
    premium: false,
    country: null,
    spam: null,
    sessions: null,
    hasAvatar: false,
    checkedAt: 0,
    detail: null,
  };

  // The stored twin of the live row: where the answer came from is not the user's problem, so the two have to read alike.
  it('reads a stored check the same way a live one does', () => {
    expect(profileVerdict({ ...PROFILE, sessions: 2 }, t).label).toBe(
      'base.status.alive · base.status.sessions',
    );
    expect(profileVerdict({ ...PROFILE, status: 'dead' }, t).tone).toBe('danger');
    expect(profileVerdict({ ...PROFILE, status: 'frozen' }, t).tone).toBe('frozen');
  });

  // Аккаунт из базы со спамблоком — тот самый случай, на котором панель рядом печатала «Спамблок» второй раз.
  it('owns the spam block it prints, so the panel beside it stays quiet', () => {
    const v = profileVerdict({ ...PROFILE, spam: { status: 'blocked', until: null } }, t);
    expect(v.label).toBe('base.spam.blocked');
    expect(v.covers).toBe('spam');
  });

  it('owns the session count only when there is one', () => {
    expect(profileVerdict({ ...PROFILE, sessions: 2 }, t).covers).toBe('sessions');
    expect(profileVerdict(PROFILE, t).covers).toBeNull();
  });
});

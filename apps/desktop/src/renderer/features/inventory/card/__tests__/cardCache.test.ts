import type { AccountSummary, AccountTag } from '@shared-types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS_KEY,
  patchAccountNote,
  patchAccountTags,
  reloadAccounts,
  withTags,
} from '../cardCache';

const item = (over: Partial<AccountSummary> = {}): AccountSummary => ({
  itemId: 1,
  category: 'steam',
  categoryRaw: 'steam',
  categoryTitle: 'Steam',
  title: 'Account',
  description: '',
  price: 0,
  currency: '',
  imageUrl: null,
  tags: [],
  warrantyEndsAt: null,
  publishedAt: null,
  purchasedAt: null,
  isPurchased: false,
  scope: 'purchased',
  steam: null,
  telegram: null,
  discord: null,
  instagram: null,
  tiktok: null,
  llmService: null,
  llm: null,
  hasEmailLogin: false,
  hasMafile: null,
  note: null,
  folder: null,
  marketItemId: null,
  localCopyId: null,
  ...over,
});

const tag = (id: number): AccountTag => ({ id, title: `tag-${id}` });

/** A service block with only the fields a test reads. */
const steamBlock = (over: Partial<NonNullable<AccountSummary['steam']>>) =>
  over as NonNullable<AccountSummary['steam']>;
const telegramBlock = (over: Partial<NonNullable<AccountSummary['telegram']>>) =>
  over as NonNullable<AccountSummary['telegram']>;

/** A client already holding a list, as the grid's would be. */
const clientWith = (list: AccountSummary[]): QueryClient => {
  const qc = new QueryClient();
  qc.setQueryData<AccountSummary[]>(ACCOUNTS_KEY, list);
  return qc;
};

const listOf = (qc: QueryClient): AccountSummary[] =>
  qc.getQueryData<AccountSummary[]>(ACCOUNTS_KEY) ?? [];

describe('withTags', () => {
  it('writes the same tags into every block the summary carries', () => {
    const next = withTags(
      item({
        steam: steamBlock({ tags: [tag(1)], country: 'DE' }),
        telegram: telegramBlock({ tags: [tag(1)] }),
      }),
      [tag(7)],
    );

    expect(next.tags).toEqual([tag(7)]);
    expect(next.steam?.tags).toEqual([tag(7)]);
    expect(next.telegram?.tags).toEqual([tag(7)]);
  });

  it('leaves the rest of a block alone', () => {
    const next = withTags(item({ steam: steamBlock({ tags: [], country: 'DE' }) }), [tag(2)]);
    expect(next.steam?.country).toBe('DE');
  });

  it('does not invent a block the summary never had', () => {
    const next = withTags(item(), [tag(1)]);
    expect(next.steam).toBeNull();
    expect(next.telegram).toBeNull();
    expect(next.discord).toBeNull();
  });

  it('leaves the account it was given untouched', () => {
    const before = item({ tags: [tag(1)] });
    withTags(before, [tag(2)]);
    expect(before.tags).toEqual([tag(1)]);
  });
});

describe('patchAccountTags', () => {
  it('rewrites one account and hands every other one back identical', () => {
    const other = item({ itemId: 2 });
    const qc = clientWith([item({ itemId: 1, tags: [tag(1)] }), other]);

    patchAccountTags(qc, 1, (tags) => [...tags, tag(5)]);

    const [first, second] = listOf(qc);
    expect(first?.tags).toEqual([tag(1), tag(5)]);
    // Identity, not equality: a new object here would re-render a card that has nothing new to show.
    expect(second).toBe(other);
  });

  it('reads the transform against the tags the account already has', () => {
    const qc = clientWith([item({ tags: [tag(1), tag(2)] })]);
    patchAccountTags(qc, 1, (tags) => tags.filter((tg) => tg.id !== 1));
    expect(listOf(qc)[0]?.tags).toEqual([tag(2)]);
  });

  it('does nothing at all when the id is not in the list', () => {
    const qc = clientWith([item({ itemId: 1 })]);
    patchAccountTags(qc, 99, () => [tag(3)]);
    expect(listOf(qc)[0]?.tags).toEqual([]);
  });

  it('survives an account whose tags were never set', () => {
    const qc = clientWith([item({ tags: undefined as unknown as AccountTag[] })]);
    patchAccountTags(qc, 1, (tags) => [...tags, tag(4)]);
    expect(listOf(qc)[0]?.tags).toEqual([tag(4)]);
  });
});

describe('patchAccountNote', () => {
  it('writes the note and nothing else', () => {
    const qc = clientWith([item({ tags: [tag(1)] })]);
    patchAccountNote(qc, 1, 'куплен на распродаже');
    const first = listOf(qc)[0];
    expect(first?.note).toBe('куплен на распродаже');
    expect(first?.tags).toEqual([tag(1)]);
  });

  it('clears it, because deleting a note is saving an empty one', () => {
    const qc = clientWith([item({ note: 'старое' })]);
    patchAccountNote(qc, 1, null);
    expect(listOf(qc)[0]?.note).toBeNull();
  });
});

describe('reloadAccounts', () => {
  it('invalidates exactly the key the grid reads', async () => {
    const qc = clientWith([item()]);
    reloadAccounts(qc);
    // The query has no fetcher here, so it cannot refetch.
    expect(qc.getQueryState(ACCOUNTS_KEY)?.isInvalidated).toBe(true);
  });
});

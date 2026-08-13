import { promises as fs, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same footing as `local-store.test.ts`: the only thing Electron is asked for is `userData`.
const userData = mkdtempSync(join(tmpdir(), 'lzt-local-labels-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}));

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { deleteLocalLabel, listLocalLabels, resetLocalLabelsForTests, saveLocalLabel } =
  await import('../label-store');

const labelsFile = join(userData, 'accounts', 'labels.json');

const readFile = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await fs.readFile(labelsFile, 'utf8'));

const writeFile = async (body: string): Promise<void> => {
  await fs.mkdir(join(userData, 'accounts'), { recursive: true });
  await fs.writeFile(labelsFile, body, 'utf8');
};

const clean = async (): Promise<void> => {
  for (const name of await fs.readdir(userData)) {
    await fs.rm(join(userData, name), { force: true, recursive: true });
  }
  resetLocalLabelsForTests();
};

beforeEach(clean);
afterEach(clean);

const add = (title: string, bc = '#e5b84b') => saveLocalLabel({ id: null, title, bc });

describe('label-store', () => {
  it('starts with no labels and no file', async () => {
    expect(await listLocalLabels()).toEqual([]);
    await expect(fs.access(labelsFile)).rejects.toThrow();
  });

  // Negative, like the account ids: these ride in the same `tags` array as the market's.
  it('hands out negative ids and writes them where a human can read them', async () => {
    expect(await add('Продажа')).toEqual({
      ok: true,
      labels: [{ id: -1, title: 'Продажа', bc: '#e5b84b' }],
    });
    expect(await add('Работа', '#ABC')).toEqual({
      ok: true,
      labels: [
        { id: -1, title: 'Продажа', bc: '#e5b84b' },
        // `#abc` is what a colour input hands back on some platforms.
        { id: -2, title: 'Работа', bc: '#aabbcc' },
      ],
    });
    expect(await readFile()).toMatchObject({ lastId: -2 });
  });

  it('refuses a title that is only whitespace', async () => {
    expect(await add('   ')).toEqual({ ok: false, message: 'empty_title' });
    expect(await listLocalLabels()).toEqual([]);
  });

  it('tidies the title instead of storing it as typed', async () => {
    await add('  Долгое   имя  ');
    expect((await listLocalLabels())[0]?.title).toBe('Долгое имя');
    await add('x'.repeat(80));
    expect((await listLocalLabels())[1]?.title).toHaveLength(24);
  });

  it('falls back to a plain colour when the renderer sends nonsense', async () => {
    await add('Без цвета', 'red');
    expect((await listLocalLabels())[0]?.bc).toBe('#3a3a3a');
  });

  it('renames and recolours a label in place', async () => {
    await add('Продажа');
    expect(await saveLocalLabel({ id: -1, title: 'Продано', bc: '#112233' })).toEqual({
      ok: true,
      labels: [{ id: -1, title: 'Продано', bc: '#112233' }],
    });
  });

  // A modal left open in another window must not be able to resurrect a label.
  it('refuses to save a label that no longer exists', async () => {
    expect(await saveLocalLabel({ id: -9, title: 'Призрак', bc: '#fff' })).toEqual({
      ok: false,
      message: 'not_found',
    });
  });

  it('deletes a label and says so when there is nothing to delete', async () => {
    await add('Продажа');
    expect(await deleteLocalLabel(-1)).toEqual({ ok: true, labels: [] });
    expect(await deleteLocalLabel(-1)).toEqual({ ok: false, message: 'not_found' });
  });

  // Accounts still wearing the deleted id would quietly change colour if the id were handed out again.
  it('never reuses the id of a deleted label', async () => {
    await add('Первая');
    await add('Вторая');
    await deleteLocalLabel(-2);
    expect(await add('Третья')).toMatchObject({ labels: [{ id: -1 }, { id: -3 }] });
  });

  it('survives a restart', async () => {
    await add('Продажа');
    resetLocalLabelsForTests();
    expect(await listLocalLabels()).toEqual([{ id: -1, title: 'Продажа', bc: '#e5b84b' }]);
  });

  // A base carried in from elsewhere may hold something this build does not understand.
  it('never overwrites a file it could not parse', async () => {
    await writeFile('{ this is not json');
    expect(await listLocalLabels()).toEqual([]);
    expect(await add('Новая')).toEqual({ ok: false, message: 'store_unreadable' });
    expect(await deleteLocalLabel(-1)).toEqual({ ok: false, message: 'store_unreadable' });
    expect(await fs.readFile(labelsFile, 'utf8')).toBe('{ this is not json');
  });

  it('reads a hand-written file and keeps its ids out of reach', async () => {
    // No counter, and a positive id that could collide with a market tag.
    await writeFile(
      JSON.stringify({
        labels: [
          { id: -4, title: 'Своя', bc: '#00FF00' },
          { id: 2, title: 'Невалид', bc: '#f00' },
          { id: -5, title: '', bc: '#f00' },
        ],
      }),
    );
    expect(await listLocalLabels()).toEqual([{ id: -4, title: 'Своя', bc: '#00ff00' }]);
    expect(await add('Следующая')).toMatchObject({ labels: [{ id: -4 }, { id: -5 }] });
  });

  /** The other half of «never overwrites a file it could not parse», and the half that is easy to miss: this file *parses*. */
  describe('a file that parses but is not this format', () => {
    const shapes: readonly [name: string, body: string][] = [
      ['a top level that is not an object', '[]'],
      ['a top level that is null', 'null'],
      ['no labels at all', '{"version":2,"items":[]}'],
      ['a labels that is not a list', '{"labels":"нет"}'],
      ['entries written some other way', '{"labels":[{"uuid":"a","name":"Своя"}]}'],
      ['a lastId that is not a counter', '{"labels":[],"lastId":"-3"}'],
      ['a lastId on the wrong side of zero', '{"labels":[],"lastId":7}'],
    ];

    for (const [name, body] of shapes) {
      it(`refuses to write over ${name}`, async () => {
        await writeFile(body);
        expect(await add('Новая')).toEqual({ ok: false, message: 'store_unreadable' });
        expect(await deleteLocalLabel(-1)).toEqual({ ok: false, message: 'store_unreadable' });
        expect(await fs.readFile(labelsFile, 'utf8')).toBe(body);
      });
    }

    // What it *could* read is still shown: a label the user can see is a label they can find the file for.
    it('still hands out whatever it could read', async () => {
      await writeFile('{"labels":[{"id":-3,"title":"Своя","bc":"#00ff00"},{"nope":1}]}');
      expect(await listLocalLabels()).toEqual([{ id: -3, title: 'Своя', bc: '#00ff00' }]);
    });

    // The file we write ourselves before anything has been handed out.
    it('does not mistake an empty label file for a foreign one', async () => {
      await writeFile('{"labels":[],"lastId":0}');
      expect(await add('Первая')).toEqual({
        ok: true,
        labels: [{ id: -1, title: 'Первая', bc: '#e5b84b' }],
      });
    });
  });
});

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { AvatarPool, readAvatarBytes, scanAvatarPack } = await import('../avatar-pack');

let dir: string;

const write = async (path: string, bytes = 8): Promise<void> => {
  await fs.mkdir(join(path, '..'), { recursive: true }).catch(() => undefined);
  await fs.writeFile(path, Buffer.alloc(bytes, 1));
};

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'avatars-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('scanAvatarPack', () => {
  it('counts stills and animations, and ignores what Telegram cannot take', async () => {
    await write(join(dir, 'a.jpg'));
    await write(join(dir, 'b.PNG'));
    await write(join(dir, 'c.webp'));
    await write(join(dir, 'd.mp4'));
    await write(join(dir, 'notes.txt'));
    await write(join(dir, 'archive.zip'));

    const pack = await scanAvatarPack(dir);
    expect(pack).toMatchObject({ dir, photos: 3, videos: 1, male: 0, female: 0, error: null });
  });

  it('reads the gender folders, in either language', async () => {
    await write(join(dir, 'male', 'm1.jpg'));
    await write(join(dir, 'male', 'm2.jpg'));
    await write(join(dir, 'жен', 'f1.jpg'));
    await write(join(dir, 'random', 'x.jpg'));

    const pack = await scanAvatarPack(dir);
    expect(pack.male).toBe(2);
    expect(pack.female).toBe(1);
    // An unrecognised subfolder is not a pool, and is not counted as one.
    expect(pack.photos).toBe(3);
  });

  // A ten-megabyte file in a pack is a wallpaper that wandered.
  it('skips an empty file and one past the size cap', async () => {
    await write(join(dir, 'ok.jpg'));
    await write(join(dir, 'zero.jpg'), 0);
    await write(join(dir, 'huge.jpg'), 11 * 1024 * 1024);

    expect(await scanAvatarPack(dir)).toMatchObject({ photos: 1, error: null });
  });

  it('says so when the folder holds nothing usable', async () => {
    await write(join(dir, 'readme.md'));
    expect((await scanAvatarPack(dir)).error).toBe('empty');
  });

  it('says so when the folder is not there', async () => {
    const pack = await scanAvatarPack(join(dir, 'nope'));
    expect(pack.error).toBe('unreadable');
  });
});

describe('AvatarPool', () => {
  it('refuses to open a folder with nothing in it', async () => {
    expect(await AvatarPool.open(dir)).toBeNull();
    expect(await AvatarPool.open(join(dir, 'nope'))).toBeNull();
  });

  // The point of the deck: a pack of ten covers ten accounts without a repeat.
  it('deals every picture before dealing any of them twice', async () => {
    for (let i = 0; i < 10; i += 1) await write(join(dir, `p${i}.jpg`));
    const pool = await AvatarPool.open(dir);
    if (!pool) throw new Error('pool');

    const dealt = Array.from({ length: 10 }, () => pool.take('male')?.name);
    expect(new Set(dealt).size).toBe(10);
    // Past the end it reshuffles rather than running dry.
    expect(pool.take('male')).not.toBeNull();
  });

  it('matches the picture to the gender when the pack is split', async () => {
    await write(join(dir, 'male', 'm.jpg'));
    await write(join(dir, 'female', 'f.jpg'));
    const pool = await AvatarPool.open(dir);
    if (!pool) throw new Error('pool');

    expect(pool.take('male')?.name).toBe('m.jpg');
    expect(pool.take('female')?.name).toBe('f.jpg');
  });

  /** A woman's name over a man's face is a worse profile than no picture at all. */
  it('falls back to the flat pool, never to the other gender', async () => {
    await write(join(dir, 'flat.jpg'));
    await write(join(dir, 'male', 'm.jpg'));
    const pool = await AvatarPool.open(dir);
    if (!pool) throw new Error('pool');

    expect(pool.take('female')?.name).toBe('flat.jpg');
  });

  it('marks an mp4 as animated', async () => {
    await write(join(dir, 'v.mp4'));
    const pool = await AvatarPool.open(dir);
    expect(pool?.take('male')?.animated).toBe(true);
  });
});

describe('readAvatarBytes', () => {
  it('reads the file it was handed', async () => {
    const path = join(dir, 'a.jpg');
    await write(path, 32);
    const bytes = await readAvatarBytes({ path, name: 'a.jpg', animated: false });
    expect(bytes.byteLength).toBe(32);
  });

  // The scan caps the size, but the file can grow between the scan and the run.
  it('refuses a file that grew past the cap since the scan', async () => {
    const path = join(dir, 'big.jpg');
    await write(path, 11 * 1024 * 1024);
    await expect(readAvatarBytes({ path, name: 'big.jpg', animated: false })).rejects.toThrow();
  });
});

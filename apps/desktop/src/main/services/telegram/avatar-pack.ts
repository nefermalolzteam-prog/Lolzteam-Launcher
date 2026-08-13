import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import type { TelegramAvatarPack } from '@shared-types';
import log from 'electron-log/main';
import type { ConcreteGender } from './names';

/** Telegram animates an `.mp4` avatar; everything else is a still. */
const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXT = new Set(['.mp4']);

/** Files past this are skipped rather than uploaded. */
const MAX_BYTES = 10 * 1024 * 1024;

const MALE_DIRS = new Set(['male', 'man', 'men', 'm', 'муж', 'мужские', 'мужчины']);
const FEMALE_DIRS = new Set(['female', 'woman', 'women', 'f', 'w', 'жен', 'женские', 'женщины']);

export interface AvatarFile {
  readonly path: string;
  /** File name alone — what the row shows. */
  readonly name: string;
  readonly animated: boolean;
}

interface Buckets {
  readonly male: AvatarFile[];
  readonly female: AvatarFile[];
  /** The flat folder, and anything in a subfolder we did not recognise. */
  readonly any: AvatarFile[];
}

const classify = (name: string): boolean | null => {
  const ext = extname(name).toLowerCase();
  if (VIDEO_EXT.has(ext)) return true;
  if (PHOTO_EXT.has(ext)) return false;
  return null;
};

/** One folder, no recursion past the gender level — a pack is not a photo library. */
const readFolder = async (dir: string): Promise<AvatarFile[]> => {
  const found: AvatarFile[] = [];
  const names = await fs.readdir(dir);
  for (const name of names) {
    const animated = classify(name);
    if (animated === null) continue;
    const path = join(dir, name);
    try {
      const stat = await fs.stat(path);
      if (!stat.isFile()) continue;
      if (stat.size === 0 || stat.size > MAX_BYTES) {
        log.warn(`[telegram/avatars] skipping ${name}: ${stat.size} bytes`);
        continue;
      }
    } catch {
      continue;
    }
    found.push({ path, name, animated });
  }
  return found;
};

const readBuckets = async (dir: string): Promise<Buckets> => {
  const buckets: Buckets = { male: [], female: [], any: [] };
  const entries = await fs.readdir(dir, { withFileTypes: true });

  buckets.any.push(...(await readFolder(dir)));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const key = entry.name.toLowerCase();
    const target = MALE_DIRS.has(key) ? buckets.male : FEMALE_DIRS.has(key) ? buckets.female : null;
    if (!target) continue;
    try {
      target.push(...(await readFolder(join(dir, entry.name))));
    } catch (err) {
      log.warn(`[telegram/avatars] failed to read ${entry.name}`, err);
    }
  }

  return buckets;
};

const count = (files: readonly AvatarFile[], animated: boolean): number =>
  files.filter((f) => f.animated === animated).length;

/** What the modal shows before a run: how much is in there, and of what kind. */
export const scanAvatarPack = async (dir: string): Promise<TelegramAvatarPack> => {
  let buckets: Buckets;
  try {
    buckets = await readBuckets(dir);
  } catch (err) {
    log.warn(`[telegram/avatars] failed to read ${dir}`, err);
    return { dir, photos: 0, videos: 0, male: 0, female: 0, error: 'unreadable' };
  }
  const all = [...buckets.any, ...buckets.male, ...buckets.female];
  return {
    dir,
    photos: count(all, false),
    videos: count(all, true),
    male: buckets.male.length,
    female: buckets.female.length,
    error: all.length === 0 ? 'empty' : null,
  };
};

/** A shuffled deck that deals every card before dealing any of them twice. */
class Deck {
  private rest: AvatarFile[] = [];

  constructor(private readonly all: readonly AvatarFile[]) {}

  get size(): number {
    return this.all.length;
  }

  take(): AvatarFile | null {
    if (this.all.length === 0) return null;
    if (this.rest.length === 0) {
      this.rest = [...this.all];
      for (let i = this.rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = this.rest[i] as AvatarFile;
        const b = this.rest[j] as AvatarFile;
        this.rest[i] = b;
        this.rest[j] = a;
      }
    }
    return this.rest.pop() ?? null;
  }
}

/** One run's pictures, handed out one per account. */
export class AvatarPool {
  private readonly male: Deck;
  private readonly female: Deck;
  private readonly any: Deck;

  private constructor(buckets: Buckets) {
    this.male = new Deck(buckets.male);
    this.female = new Deck(buckets.female);
    this.any = new Deck(buckets.any);
  }

  /** `null` when the folder is unreadable or holds nothing we can upload. */
  static async open(dir: string): Promise<AvatarPool | null> {
    let buckets: Buckets;
    try {
      buckets = await readBuckets(dir);
    } catch (err) {
      log.warn(`[telegram/avatars] failed to read ${dir}`, err);
      return null;
    }
    const pool = new AvatarPool(buckets);
    return pool.empty ? null : pool;
  }

  get empty(): boolean {
    return this.male.size + this.female.size + this.any.size === 0;
  }

  /** The gendered pool when the pack has one, the flat pool otherwise. */
  take(gender: ConcreteGender): AvatarFile | null {
    const preferred = gender === 'male' ? this.male : this.female;
    return preferred.take() ?? this.any.take();
  }
}

/** Reads the picture itself. */
export const readAvatarBytes = async (file: AvatarFile): Promise<Uint8Array> => {
  const buf = await fs.readFile(file.path);
  if (buf.byteLength > MAX_BYTES) throw new Error(`${file.name}: слишком большой файл`);
  return buf;
};

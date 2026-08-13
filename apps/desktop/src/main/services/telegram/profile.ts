import type { TelegramClient } from '@mtcute/core/client.js';
import type { TelegramCheckInfo, TelegramProfileFill, TelegramTaskStep } from '@shared-types';
import log from 'electron-log/main';
import { type AvatarPool, readAvatarBytes } from './avatar-pack';
import {
  checkInfoFromUser,
  deadCheckInfo,
  downloadAvatar,
  frozenCheckInfo,
  isDeadKeyError,
  isFrozenError,
  readFreezeState,
} from './checker';
import { BIO_MAX, type ConcreteLocale, type NameGenerator, generateBio } from './names';

export interface FillOptions {
  /** Shared by the whole run, not built per account. */
  readonly names: NameGenerator;
  readonly withName: boolean;
  readonly withBio: boolean;
  /** `null` leaves the picture alone; the pool is shared by the whole run. */
  readonly avatars: AvatarPool | null;
  readonly replaceAvatar: boolean;
}

export interface FillResult {
  readonly fill: TelegramProfileFill;
  readonly info: TelegramCheckInfo;
  /** The account's picture as Telegram now stores it, for the account list. */
  readonly avatar: Uint8Array | null | undefined;
}

const EMPTY: TelegramProfileFill = {
  firstName: null,
  lastName: null,
  bio: null,
  avatar: null,
  animated: false,
};

/** Telegram rejects an over-long bio outright, so the pool is checked, not trimmed. */
const bioFor = (locale: ConcreteLocale): string | null => {
  const bio = generateBio(locale);
  if (bio.length <= BIO_MAX) return bio;
  log.warn(`[telegram/profile] bio over ${BIO_MAX} chars, skipped: ${bio}`);
  return null;
};

/** Clears the pictures already on the account. */
const clearPhotos = async (client: TelegramClient): Promise<void> => {
  const photos = await client.getProfilePhotos('me', { limit: 100 });
  if (photos.length === 0) return;
  await client.deleteProfilePhotos(photos.map((p) => p.inputPhoto));
};

export const fillTelegramProfile = async (
  client: TelegramClient,
  options: FillOptions,
  report: (step: TelegramTaskStep) => void,
): Promise<FillResult> => {
  report('me');
  // The call is made for its failure, not its answer: a dead key has to be reported as a check would report it.
  let me: Awaited<ReturnType<TelegramClient['getMe']>>;
  try {
    me = await client.getMe();
  } catch (err) {
    const reason = isDeadKeyError(err);
    if (reason) return { fill: EMPTY, info: deadCheckInfo(reason), avatar: undefined };
    const frozen = isFrozenError(err);
    if (frozen) return { fill: EMPTY, info: frozenCheckInfo(frozen), avatar: undefined };
    throw err;
  }

  // The same stop, one step further along: a frozen account answers `getMe` and then refuses every write.
  let frozen = await readFreezeState(client);
  if (frozen) {
    return { fill: EMPTY, info: checkInfoFromUser(me, { frozen }), avatar: undefined };
  }

  const name = options.names.next();
  let fill: TelegramProfileFill = EMPTY;

  if (options.withName || options.withBio) {
    report('name');
    const bio = options.withBio ? bioFor(name.locale) : null;
    try {
      await client.updateProfile({
        ...(options.withName ? { firstName: name.firstName, lastName: name.lastName } : {}),
        ...(bio ? { bio } : {}),
      });
      fill = {
        ...fill,
        firstName: options.withName ? name.firstName : null,
        lastName: options.withName ? name.lastName : null,
        bio,
      };
    } catch (err) {
      // The write is the second, louder way a freeze announces itself.
      frozen = isFrozenError(err);
      if (!frozen) throw err;
      return { fill: EMPTY, info: checkInfoFromUser(me, { frozen }), avatar: undefined };
    }
  }

  if (options.avatars) {
    const file = options.avatars.take(name.gender);
    if (file) {
      report('photo');
      try {
        if (options.replaceAvatar) await clearPhotos(client);
        await client.setMyProfilePhoto({
          type: file.animated ? 'video' : 'photo',
          media: await readAvatarBytes(file),
        });
        fill = { ...fill, avatar: file.name, animated: file.animated };
      } catch (err) {
        // A freeze is not an unlucky picture: it is the account refusing every write.
        frozen = isFrozenError(err);
        if (frozen) {
          return { fill: EMPTY, info: checkInfoFromUser(me, { frozen }), avatar: undefined };
        }
        // The name went through; losing the run over the picture would cost the user that name on the re-run.
        log.warn(`[telegram/profile] avatar ${file.name} failed`, err);
      }
    }
  }

  // Read back rather than assume: this is what the account list will show.
  report('avatar');
  const updated = await client.getMe();
  return {
    fill,
    // `frozen` is threaded through rather than dropped: the read-back cannot see a freeze.
    info: checkInfoFromUser(updated, { frozen }),
    avatar: await downloadAvatar(client, updated),
  };
};

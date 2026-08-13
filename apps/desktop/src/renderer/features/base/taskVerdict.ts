import type { TelegramProfile, TelegramTaskRow } from '@shared-types';
import type { TFunction } from 'i18next';
import {
  CircleHelp,
  Eraser,
  Loader2,
  ShieldAlert,
  ShieldHalf,
  Snowflake,
  UserRoundX,
} from 'lucide-react';
import type { ComponentType } from 'react';
import {
  AlertIcon,
  CheckIcon,
  CrossIcon,
  PencilIcon,
  PlusCircleIcon,
  ShieldIcon,
} from '~/widgets/icons/Icons';

/** What a run has to say about one account, in the shortest form that is still honest — as data rather than as markup. */
export type TaskVerdictTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'frozen';

/** The glyph beside the wording, from either of the two families the app draws with: lucide's. */
export type VerdictIcon = ComponentType<{ size?: number | string; className?: string }>;

/** Что этот вердикт уже сказал — чтобы соседняя панель не сказала того же ещё раз. */
export type VerdictCovers = 'spam' | 'sessions' | null;

export interface TaskVerdict {
  readonly icon: VerdictIcon | null;
  /** The icon turns while the runner is still working on this account. */
  readonly spin: boolean;
  readonly label: string;
  readonly tone: TaskVerdictTone;
  /** The detail behind the label, for the tooltip. */
  readonly title: string | null;
  readonly covers: VerdictCovers;
}

const verdict = (
  icon: VerdictIcon | null,
  label: string,
  tone: TaskVerdictTone = 'neutral',
  title: string | null = null,
  spin = false,
  covers: VerdictCovers = null,
): TaskVerdict => ({ icon, label, tone, title, spin, covers });

/** What a live run row says. */
export const rowVerdict = (row: TelegramTaskRow, t: TFunction): TaskVerdict => {
  if (row.state === 'queued') return verdict(null, t('base.status.queued'));
  if (row.state === 'skipped') return verdict(null, t('base.status.skipped'));

  if (row.state === 'running') {
    return verdict(
      Loader2,
      row.step === 'waiting' && row.waitSeconds !== null
        ? t('base.status.waiting', { seconds: row.waitSeconds })
        : t(`base.steps.${row.step ?? 'resolving'}`),
      'neutral',
      null,
      true,
    );
  }

  if (row.state === 'failed') {
    return verdict(
      AlertIcon,
      row.error === 'flood_wait' && row.waitSeconds !== null
        ? t('base.status.floodWait', { seconds: row.waitSeconds })
        : t(`base.errors.${row.error ?? 'unknown'}`),
      'danger',
      row.detail,
    );
  }

  /** What a friends purge did, read before the check verdict below. */
  const friends = row.friends;
  if (friends) {
    const touched = friends.removed + friends.blocked;
    const label =
      (touched === 0
        ? t('base.status.friendsNothing')
        : t(friends.blocked > 0 ? 'base.status.friendsBlocked' : 'base.status.friendsRemoved', {
            count: touched,
          })) +
      (friends.failed > 0 ? ` · ${t('base.status.cleanFailed', { count: friends.failed })}` : '');
    return verdict(
      UserRoundX,
      label,
      friends.failed > 0 ? 'warn' : 'ok',
      t('base.status.friendsHint', { scanned: friends.scanned, kept: friends.kept }),
    );
  }

  /** A Steam verdict, read before the Telegram ones because it is the only thing a Steam row carries. */
  const steam = row.steam;
  if (steam) {
    if (steam.status === 'unlinked') {
      return verdict(CircleHelp, t('base.steam.unlinked'), 'warn', t('base.steam.unlinkedHint'));
    }
    if (steam.status === 'dead') {
      return verdict(
        /** A bare cross for «мёртв», here and in the two Telegram branches below. */
        CrossIcon,
        t('base.status.dead'),
        'danger',
        // Our own word for why, translated like every other verdict — the exception `steam-session` threw never leaves main.
        steam.detail ? t(`base.steam.detail.${steam.detail}`) : null,
      );
    }
    if (steam.vacBanned === true) {
      return verdict(ShieldAlert, t('base.steam.vac'), 'danger', steam.nickname);
    }
    if (steam.tradeBanState !== null && steam.tradeBanState !== 'None') {
      return verdict(AlertIcon, t('base.steam.trade'), 'warn', steam.tradeBanState);
    }
    /** A bare tick for «жив», here and in the two Telegram branches below. */
    return verdict(
      CheckIcon,
      t('base.status.alive') + (steam.limited === true ? ` · ${t('base.steam.limited')}` : ''),
      'ok',
      steam.nickname,
    );
  }

  /** What a mass link did, and the reason `SteamLinkResult` exists at all. */
  const link = row.link;
  if (link) {
    return link.already
      ? verdict(ShieldIcon, t('base.status.linkedAlready'), 'neutral', link.accountName)
      : verdict(PlusCircleIcon, t('base.status.linked'), 'ok', link.accountName);
  }

  const check = row.check;

  // A profile run's news is what it wrote, not that the account is alive — the user already knew.
  const filled = row.filled;
  if (filled && (filled.firstName || filled.bio || filled.avatar)) {
    const name = [filled.firstName, filled.lastName].filter(Boolean).join(' ');
    const parts = [
      name,
      filled.avatar
        ? t(filled.animated ? 'base.status.filledVideo' : 'base.status.filledPhoto')
        : null,
    ].filter(Boolean);
    /** Наш карандаш вместо lucide-евского `UserRoundPen` — «человек с карандашом». */
    return verdict(PencilIcon, parts.join(' · ') || t('base.status.filled'), 'ok', filled.bio);
  }

  if (!check) return verdict(null, t('base.status.done'), 'ok');

  /** A cleanup's and a privacy run's news, on the same principle the profile fill follows: what was done to the account. */
  if (check.status === 'alive') {
    const cleaned = row.cleaned;
    if (cleaned) {
      // Contacts and folders count towards «убрано» like anything else the run removed: from where the user sits.
      const touched = cleaned.left + cleaned.deleted + cleaned.contacts + cleaned.folders;
      const label =
        (touched === 0
          ? t('base.status.cleanedNothing')
          : t('base.status.cleaned', { count: touched })) +
        (cleaned.failed > 0 ? ` · ${t('base.status.cleanFailed', { count: cleaned.failed })}` : '');
      return verdict(
        Eraser,
        label,
        cleaned.failed > 0 ? 'warn' : 'ok',
        t('base.status.cleanedHint', { scanned: cleaned.scanned }) +
          (cleaned.contacts > 0
            ? ` · ${t('base.status.cleanedContacts', { count: cleaned.contacts })}`
            : '') +
          (cleaned.folders > 0
            ? ` · ${t('base.status.cleanedFolders', { count: cleaned.folders })}`
            : ''),
      );
    }

    const privacy = row.privacy;
    if (privacy) {
      // Premium-only keys are named apart from the failures: the account cannot have them.
      const extra = [
        privacy.needsPremium.length > 0
          ? t('base.status.privacyPremium', { count: privacy.needsPremium.length })
          : null,
        privacy.failed.length > 0
          ? t('base.status.privacyFailed', { count: privacy.failed.length })
          : null,
      ].filter(Boolean);
      return verdict(
        ShieldHalf,
        t('base.status.privacyApplied', { count: privacy.applied.length }) +
          (extra.length > 0 ? ` · ${extra.join(' · ')}` : ''),
        privacy.failed.length > 0 ? 'warn' : 'ok',
      );
    }
  }

  if (check.status === 'dead') {
    return verdict(CrossIcon, t('base.status.dead'), 'danger', check.detail);
  }

  // Its own tone, between the two: the key works.
  if (check.status === 'frozen') {
    return verdict(Snowflake, t('base.status.frozen'), 'frozen', check.detail);
  }

  const spam = check.spam;
  if (spam && spam.status !== 'free') {
    const until = spam.until ? new Date(spam.until).toLocaleDateString() : null;
    return verdict(
      AlertIcon,
      t(`base.spam.${spam.status}`) + (until ? ` · ${until}` : ''),
      spam.status === 'blocked' ? 'danger' : 'warn',
      null,
      false,
      'spam',
    );
  }

  return verdict(
    CheckIcon,
    t('base.status.alive') +
      (check.sessions !== null ? ` · ${t('base.status.sessions', { count: check.sessions })}` : ''),
    'ok',
    null,
    false,
    // Число сессий дописано только если проверка его вернула; без него ветка не покрывает ничего.
    check.sessions !== null ? 'sessions' : null,
  );
};

/** The same verdict, read back from disk instead of from a live run. */
export const profileVerdict = (profile: TelegramProfile, t: TFunction): TaskVerdict => {
  if (profile.status === 'dead') {
    return verdict(CrossIcon, t('base.status.dead'), 'danger', profile.detail);
  }

  if (profile.status === 'frozen') {
    return verdict(Snowflake, t('base.status.frozen'), 'frozen', profile.detail);
  }

  const spam = profile.spam;
  if (spam && spam.status !== 'free') {
    const until = spam.until ? new Date(spam.until).toLocaleDateString() : null;
    return verdict(
      AlertIcon,
      t(`base.spam.${spam.status}`) + (until ? ` · ${until}` : ''),
      spam.status === 'blocked' ? 'danger' : 'warn',
      null,
      false,
      'spam',
    );
  }

  return verdict(
    CheckIcon,
    t('base.status.alive') +
      (profile.sessions !== null
        ? ` · ${t('base.status.sessions', { count: profile.sessions })}`
        : ''),
    'ok',
    null,
    false,
    profile.sessions !== null ? 'sessions' : null,
  );
};

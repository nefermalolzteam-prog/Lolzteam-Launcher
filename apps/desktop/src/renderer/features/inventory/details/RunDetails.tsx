import { useTranslation } from 'react-i18next';
import { profileVerdict, rowVerdict } from '~/features/base/taskVerdict';
import { sentence } from '~/lib/sentence';
import { formatAgo } from '~/lib/time';
import { useTelegramProfiles } from '~/stores/telegramProfiles';
import { useTelegramTasks } from '~/stores/telegramTasks';
import s from '../AccountCard.module.scss';
import { isCheckable } from '../checkable';
import { Badge } from './Badge';
import type { AccountDetailsProps } from './types';

/** Whatever the last «База» run had to say about this account, as one badge among the rest of what is known about it. */
export const RunDetails = ({ item }: AccountDetailsProps) => {
  const { t, i18n } = useTranslation();
  const row = useTelegramTasks((st) => st.rows.get(item.itemId));
  const rowAt = useTelegramTasks((st) => st.rowAt.get(item.itemId));
  const profile = useTelegramProfiles((st) => st.profiles.get(item.itemId));

  // A run cannot reach a bought Steam account.
  if (!isCheckable(item)) return null;

  const verdict = row ? rowVerdict(row, t) : profile ? profileVerdict(profile, t) : null;
  if (!verdict) return null;

  const at = row ? rowAt : profile?.checkedAt;
  const ago = at ? formatAgo(at, i18n.language) : null;
  const title = [verdict.title, ago].filter(Boolean).join(' · ');
  const Icon = verdict.icon;

  return (
    <div className={s.badges}>
      <Badge
        tone={verdict.tone}
        icon={Icon ? <Icon size={12} className={verdict.spin ? s.spin : undefined} /> : undefined}
        title={title || undefined}
      >
        {/* The verdict is data and stays lowercase where it is built. */}
        {sentence(verdict.label)}
      </Badge>
    </div>
  );
};

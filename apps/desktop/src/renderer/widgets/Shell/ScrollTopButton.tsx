import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpIcon } from '~/widgets/icons/Icons';
import s from './ScrollTopButton.module.scss';
import { useScrollRoot } from './scrollRoot';

/** How far down counts as «scrolled». */
const THRESHOLD = 320;

interface ScrollTopButtonProps {
  /** Ужаться, потому что угол занят не только этим. */
  compact?: boolean;
}

export const ScrollTopButton = ({ compact }: ScrollTopButtonProps) => {
  const { t } = useTranslation();
  const root = useScrollRoot();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!root) return;
    const read = () => setScrolled(root.scrollTop > THRESHOLD);
    // Once up front: the root can arrive already scrolled — a view swap keeps the same `<main>`.
    read();
    root.addEventListener('scroll', read, { passive: true });
    return () => root.removeEventListener('scroll', read);
  }, [root]);

  if (!root || !scrolled) return null;

  return (
    <button
      type="button"
      className={`${s.button} ${compact ? s.buttonCompact : ''}`}
      onClick={() => root.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label={t('sidebar.scrollTop')}
      title={t('sidebar.scrollTop')}
    >
      <span className={s.disc}>
        <ArrowUpIcon size={compact ? 20 : 24} />
      </span>
    </button>
  );
};

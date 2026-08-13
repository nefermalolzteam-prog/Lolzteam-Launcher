import s from './AccountCard.module.scss';

const PALETTE = [
  '#e17076',
  '#faa774',
  '#a695e7',
  '#7bc862',
  '#6ec9cb',
  '#65aadd',
  '#ee7aae',
] as const;

/** Up to two letters, by code point rather than by char: a name that starts with an emoji is common enough here. */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();

interface InitialsAvatarProps {
  name: string;
  /** Telegram's user id when we know it, the account id otherwise. */
  seed: number;
  size: number;
  className?: string;
}

export const InitialsAvatar = ({ name, seed, size, className = '' }: InitialsAvatarProps) => (
  <span
    className={`${s.initialsAvatar} ${className}`}
    style={{
      width: size,
      height: size,
      fontSize: Math.round(size * 0.42),
      backgroundColor: PALETTE[Math.abs(seed) % PALETTE.length],
    }}
    aria-hidden="true"
  >
    {initialsOf(name)}
  </span>
);

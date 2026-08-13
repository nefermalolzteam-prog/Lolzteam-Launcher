import { Loader2 } from 'lucide-react';
import type { ComponentPropsWithRef, ComponentType } from 'react';
import s from './Button.module.scss';

export type ButtonVariant = 'accent' | 'neutral' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonShape = 'pill' | 'rounded';

// `noUncheckedIndexedAccess` makes a hashed class name `string | undefined`.
const VARIANT: Record<ButtonVariant, string | undefined> = {
  accent: s.accent,
  neutral: s.neutral,
  ghost: s.ghost,
  danger: s.danger,
};

const SIZE: Record<ButtonSize, string | undefined> = { sm: s.sm, md: s.md, lg: s.lg };

const SHAPE: Record<ButtonShape, string | undefined> = { pill: s.pill, rounded: s.rounded };

/** The icon follows the text, so its size lives here and not at the call site. */
const ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 17, lg: 18 };

interface ButtonBase {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  /** A spinner takes the icon's place and the button stops accepting presses. */
  busy?: boolean;
  /** Fills the width of whatever holds it. */
  block?: boolean;
}

/** Всё, что умеет нарисовать себя в квадрате `size` пикселей: значки lucide и наши собственные из `widgets/icons` наравне. */
export type ButtonIcon = ComponentType<{ size?: number | string; 'aria-hidden'?: boolean }>;

/** An icon on its own still has to say what it does. */
type ButtonContent =
  | { iconOnly: true; icon: ButtonIcon; label: string; children?: never }
  | { iconOnly?: false; icon?: ButtonIcon; label?: string };

export type ButtonProps = ComponentPropsWithRef<'button'> & ButtonBase & ButtonContent;

export const Button = ({
  variant = 'neutral',
  size = 'md',
  shape = 'rounded',
  busy = false,
  block = false,
  iconOnly = false,
  icon: Icon,
  label,
  className,
  disabled,
  type = 'button',
  title,
  'aria-label': ariaLabel,
  children,
  ...rest
}: ButtonProps) => {
  const iconSize = ICON_SIZE[size];
  const text = iconOnly ? null : (children ?? label);
  const classes = [
    s.button,
    VARIANT[variant],
    SIZE[size],
    SHAPE[shape],
    iconOnly ? s.iconOnly : null,
    block ? s.block : null,
    busy ? s.busy : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      // Busy is a kind of disabled: the press has already happened and the answer is on its way.
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      title={title ?? label}
      aria-label={ariaLabel ?? (iconOnly ? label : undefined)}
    >
      {busy ? (
        <Loader2 size={iconSize} className={s.spinner} aria-hidden />
      ) : Icon ? (
        <Icon size={iconSize} aria-hidden />
      ) : null}
      {text !== null && text !== undefined && <span className={s.label}>{text}</span>}
    </button>
  );
};

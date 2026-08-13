import { Check } from 'lucide-react';
import type { PropsWithChildren, ReactNode } from 'react';
import { useMenuClose } from './Menu';
import s from './Menu.module.scss';

interface MenuItemProps {
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  className?: string;
}

export const MenuItem = ({
  icon,
  onSelect,
  disabled,
  danger,
  checked,
  className,
  children,
}: PropsWithChildren<MenuItemProps>) => {
  const close = useMenuClose();
  const radio = checked !== undefined;

  return (
    <button
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? checked : undefined}
      disabled={disabled}
      className={`${s.item} ${danger ? s.itemDanger : ''} ${checked ? s.itemActive : ''} ${className ?? ''}`}
      onClick={() => {
        close();
        onSelect?.();
      }}
    >
      {icon && <span className={s.itemIcon}>{icon}</span>}
      <span className={s.itemLabel}>{children}</span>
      {checked && <Check size={14} />}
    </button>
  );
};

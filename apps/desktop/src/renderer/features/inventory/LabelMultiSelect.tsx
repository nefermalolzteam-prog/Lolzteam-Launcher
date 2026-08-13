import type { UserLabel } from '@shared-types';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labelColors } from '~/lib/labelColor';
import { useDismiss } from '~/lib/useDismiss';
import s from './LabelMultiSelect.module.scss';

/** All a picker needs of a label. */
export type LabelChoice = Pick<UserLabel, 'id' | 'title' | 'bc'>;

interface LabelMultiSelectProps {
  title: string;
  labels: readonly LabelChoice[];
  selected: number[];
  onToggle: (id: number) => void;
  variant: 'include' | 'exclude';
}

export const LabelMultiSelect = ({
  title,
  labels,
  selected,
  onToggle,
  variant,
}: LabelMultiSelectProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const selectedLabels = labels.filter((l) => selected.includes(l.id));

  return (
    <div className={s.group}>
      <span className={s.groupLabel}>{title}</span>
      <div className={s.root} ref={rootRef}>
        <button
          type="button"
          className={s.control}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={s.value}>
            {selectedLabels.length === 0 ? (
              <span className={s.placeholder}>{t('inventory.filters.labelAny')}</span>
            ) : (
              selectedLabels.map((label) => {
                const c = labelColors(label.bc);
                return (
                  <span
                    key={label.id}
                    className={`${s.chip} ${variant === 'exclude' ? s.chipExclude : ''}`}
                    style={
                      variant === 'include'
                        ? { backgroundColor: c.background, color: c.text }
                        : undefined
                    }
                  >
                    {label.title}
                  </span>
                );
              })
            )}
          </span>
          <ChevronDown size={15} className={`${s.chevron} ${open ? s.chevronOpen : ''}`} />
        </button>

        {open && (
          <div className={s.menu}>
            {labels.map((label) => {
              const on = selected.includes(label.id);
              const c = labelColors(label.bc);
              return (
                <button
                  key={label.id}
                  type="button"
                  aria-pressed={on}
                  className={`${s.option} ${on ? s.optionOn : ''}`}
                  onClick={() => onToggle(label.id)}
                >
                  <span className={s.dot} style={{ backgroundColor: c.background }} />
                  <span className={s.optionTitle}>{label.title}</span>
                  {on && (
                    <Check size={15} className={variant === 'exclude' ? s.checkExclude : ''} />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

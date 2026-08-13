import { LLM_SERVICES, LLM_SERVICE_LABELS, type LlmServiceId } from '@shared-types';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '~/lib/useDismiss';
import { Menu } from '~/widgets/Menu/Menu';
import { MenuItem } from '~/widgets/Menu/MenuItem';
import s from './LlmServiceFilter.module.scss';

export type LlmServiceFilterValue = LlmServiceId | 'all';

interface LlmServiceFilterProps {
  value: LlmServiceFilterValue;
  onChange: (value: LlmServiceFilterValue) => void;
}

export const LlmServiceFilter = ({ value, onChange }: LlmServiceFilterProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useDismiss(open, () => setOpen(false));

  const options: LlmServiceFilterValue[] = ['all', ...LLM_SERVICES];
  const labelOf = (v: LlmServiceFilterValue): string =>
    v === 'all' ? t('inventory.llmService.all') : LLM_SERVICE_LABELS[v];

  return (
    <div className={s.wrap} ref={rootRef}>
      <button
        type="button"
        className={`${s.trigger} ${value !== 'all' ? s.triggerActive : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{labelOf(value)}</span>
        <ChevronDown size={14} className={`${s.chevron} ${open ? s.chevronOpen : ''}`} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} label={t('inventory.llmService.all')}>
        {options.map((opt) => (
          <MenuItem key={opt} checked={value === opt} onSelect={() => onChange(opt)}>
            {labelOf(opt)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
};

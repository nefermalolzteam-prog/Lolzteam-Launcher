import { useTranslation } from 'react-i18next';
import s from './LocalImport.module.scss';

export type ImportMode = 'single' | 'bulk';

const MODES: readonly ImportMode[] = ['single', 'bulk'];

/** Step 2: one account by hand, or a pile of files and lines. */
export const ModeStep = ({ onPick }: { onPick: (mode: ImportMode) => void }) => {
  const { t } = useTranslation();
  return (
    <div className={s.body}>
      <p className={s.lead}>{t('inventory.localImport.modeLead')}</p>
      <div className={s.cards}>
        {MODES.map((mode) => (
          <button key={mode} type="button" className={s.card} onClick={() => onPick(mode)}>
            <span className={s.cardTitle}>{t(`inventory.localImport.mode.${mode}`)}</span>
            <span className={s.cardText}>{t(`inventory.localImport.modeText.${mode}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

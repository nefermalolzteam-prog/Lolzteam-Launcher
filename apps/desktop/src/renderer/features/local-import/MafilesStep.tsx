import type { LocalImportFile } from '@shared-types';
import { useTranslation } from 'react-i18next';
import { DropZone } from './DropZone';
import s from './LocalImport.module.scss';

export interface MafilesStepProps {
  files: readonly LocalImportFile[];
  onAdd: (files: LocalImportFile[]) => void;
  onClear: () => void;
  onNext: () => void;
}

/** Step 3 (Steam, bulk): the maFiles, dropped as a folder or picked by hand. */
export const MafilesStep = ({ files, onAdd, onClear, onNext }: MafilesStepProps) => {
  const { t } = useTranslation();
  return (
    <div className={s.body}>
      <p className={s.lead}>{t('inventory.localImport.mafilesLead')}</p>
      <DropZone
        extensions={['.mafile', '.json']}
        accept=".maFile,.json"
        label={t('inventory.localImport.dropMafiles')}
        hint={t('inventory.localImport.dropMafilesHint')}
        onFiles={onAdd}
      />
      <div className={s.footer}>
        <span className={s.counter}>
          {t('inventory.localImport.filesCount', { count: files.length })}
        </span>
        <div className={s.btnRow}>
          {files.length > 0 && (
            <button type="button" className={s.secondary} onClick={onClear}>
              {t('inventory.localImport.clear')}
            </button>
          )}
          <button type="button" className={s.primary} onClick={onNext}>
            {t('inventory.localImport.next')}
          </button>
        </div>
      </div>
    </div>
  );
};

import { FolderSearch, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropZone } from './DropZone';
import s from './LocalImport.module.scss';
import { countAuthKeyLines } from './parse';

const DC_IDS = [1, 2, 3, 4, 5] as const;

export interface AuthKeysStepProps {
  text: string;
  onText: (text: string) => void;
  dcId: number;
  onDcId: (dcId: number) => void;
  /** Folder main reads itself: tdata directories, `.session` files, `.txt` lists. */
  dir: string | null;
  onDir: (dir: string | null) => void;
  busy: boolean;
  onAnalyze: () => void;
}

/** Step 3 (Telegram, bulk): a folder holding the base, keys pasted one per line, or both. */
export const AuthKeysStep = ({
  text,
  onText,
  dcId,
  onDcId,
  dir,
  onDir,
  busy,
  onAnalyze,
}: AuthKeysStepProps) => {
  const { t } = useTranslation();
  const count = countAuthKeyLines(text);

  const pick = async () => {
    const picked = await window.launcher.telegram.pickPath(
      'dir',
      t('inventory.localImport.pickBaseTitle'),
    );
    if (picked.path) onDir(picked.path);
  };

  return (
    <div className={s.body}>
      <p className={s.lead}>{t('inventory.localImport.authKeysLead')}</p>

      <div className={s.dirRow}>
        <button type="button" className={s.secondary} onClick={() => void pick()}>
          <FolderSearch size={14} />
          <span>{t('inventory.localImport.pickBase')}</span>
        </button>
        {dir && (
          <>
            <span className={s.dirPath} title={dir}>
              {dir}
            </span>
            <button
              type="button"
              className={s.dirClear}
              onClick={() => onDir(null)}
              aria-label={t('inventory.localImport.clear')}
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>

      <textarea
        className={s.textarea}
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder={t('inventory.localImport.authKeysPlaceholder')}
        spellCheck={false}
        autoFocus
      />
      <DropZone
        extensions={['.txt', '.csv']}
        accept=".txt,.csv"
        label={t('inventory.localImport.dropText')}
        onFiles={(files) =>
          onText([text, ...files.map((f) => f.text)].filter((part) => part.length > 0).join('\n'))
        }
      />
      {/* Only used by keys pasted without their own `:<dc>` suffix. */}
      <div className={s.dcRow}>
        <span>{t('inventory.localImport.dcLabel')}</span>
        {DC_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`${s.dcBtn} ${dcId === id ? s.dcBtnOn : ''}`}
            aria-pressed={dcId === id}
            onClick={() => onDcId(id)}
          >
            {id}
          </button>
        ))}
      </div>
      <div className={s.footer}>
        <span className={s.counter}>{t('inventory.localImport.keysCount', { count })}</span>
        <button
          type="button"
          className={s.primary}
          onClick={onAnalyze}
          disabled={busy || (count === 0 && dir === null)}
        >
          {busy && <Loader2 size={14} className={s.spin} />}
          <span>{t('inventory.localImport.analyze')}</span>
        </button>
      </div>
    </div>
  );
};

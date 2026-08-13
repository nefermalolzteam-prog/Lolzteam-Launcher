import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropZone } from './DropZone';
import s from './LocalImport.module.scss';
import { countCredentialLines } from './parse';

export interface CredentialsStepProps {
  text: string;
  onText: (text: string) => void;
  busy: boolean;
  onAnalyze: () => void;
}

/** Step 4 (Steam, bulk): the `login:pass` list the maFiles get matched against. */
export const CredentialsStep = ({ text, onText, busy, onAnalyze }: CredentialsStepProps) => {
  const { t } = useTranslation();
  const count = countCredentialLines(text);

  return (
    <div className={s.body}>
      <p className={s.lead}>{t('inventory.localImport.credentialsLead')}</p>
      <textarea
        className={s.textarea}
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder={t('inventory.localImport.credentialsPlaceholder')}
        spellCheck={false}
        autoFocus
      />
      <DropZone
        extensions={['.txt', '.csv']}
        accept=".txt,.csv"
        label={t('inventory.localImport.dropText')}
        // Appended, so several lists can be dropped one after another.
        onFiles={(files) =>
          onText([text, ...files.map((f) => f.text)].filter((part) => part.length > 0).join('\n'))
        }
      />
      <div className={s.footer}>
        <span className={s.counter}>{t('inventory.localImport.linesCount', { count })}</span>
        <button type="button" className={s.primary} onClick={onAnalyze} disabled={busy}>
          {busy && <Loader2 size={14} className={s.spin} />}
          <span>{t('inventory.localImport.analyze')}</span>
        </button>
      </div>
    </div>
  );
};

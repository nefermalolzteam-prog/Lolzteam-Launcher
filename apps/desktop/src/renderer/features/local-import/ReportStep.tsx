import type { LocalImportGroups, LocalImportPreview, LocalImportRow } from '@shared-types';
import type { TFunction } from 'i18next';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import s from './LocalImport.module.scss';

type GroupKey = keyof LocalImportGroups;

const GROUPS: readonly GroupKey[] = [
  'matched',
  'missingGuard',
  'orphanFiles',
  'duplicates',
  'invalid',
];

/** Rejection reasons come from two places: the import planner's own codes and the shared validator's. */
const reasonText = (t: TFunction, reason: string): string => {
  const own = `inventory.localImport.reasons.${reason}`;
  if (t(own) !== own) return t(own);
  const shared = `inventory.local.errors.${reason}`;
  return t(shared) === shared ? reason : t(shared);
};

const Group = ({ id, rows }: { id: string; rows: readonly LocalImportRow[] }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;

  return (
    <div className={s.group}>
      <button type="button" className={s.groupHead} onClick={() => setOpen((v) => !v)}>
        <span className={s.groupTitle}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t(`inventory.localImport.groups.${id}`)}
        </span>
        <span className={s.groupCount}>{rows.length}</span>
      </button>
      {open && (
        <ul className={s.rows}>
          {rows.map((row, i) => (
            <li key={`${row.title}-${i}`} className={s.row}>
              <span>{row.title}</span>
              {row.source && <span className={s.rowMeta}>{row.source}</span>}
              {row.reason && <span className={s.rowMeta}>{reasonText(t, row.reason)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export interface ImportResult {
  readonly created: number;
  /** Rows the store refused — the rest went in. */
  readonly failed: LocalImportRow[];
}

export interface ReportStepProps {
  preview: LocalImportPreview;
  includeMissingGuard: boolean;
  onToggleMissingGuard: () => void;
  /** Set once the import ran; the token is spent, so the step turns into a summary. */
  result: ImportResult | null;
  busy: boolean;
  error: string | null;
  onCommit: () => void;
  onCancel: () => void;
  onDone: () => void;
}

export const ReportStep = ({
  preview,
  includeMissingGuard,
  onToggleMissingGuard,
  result,
  busy,
  error,
  onCommit,
  onCancel,
  onDone,
}: ReportStepProps) => {
  const { t } = useTranslation();
  const { groups } = preview;
  const total = groups.matched.length + (includeMissingGuard ? groups.missingGuard.length : 0);

  if (result) {
    return (
      <div className={s.body}>
        <p className={s.lead}>{t('inventory.localImport.created', { count: result.created })}</p>
        <Group id="failed" rows={result.failed} />
        <div className={s.footer}>
          <span />
          <button type="button" className={s.primary} onClick={onDone}>
            {t('inventory.localImport.done')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.body}>
      <p className={s.lead}>{t('inventory.localImport.reportLead')}</p>

      {GROUPS.map((id) => (
        <Group key={id} id={id} rows={groups[id]} />
      ))}

      {groups.missingGuard.length > 0 && (
        <button
          type="button"
          role="checkbox"
          aria-checked={includeMissingGuard}
          className={s.checkRow}
          onClick={onToggleMissingGuard}
        >
          <span className={`${s.checkbox} ${includeMissingGuard ? s.checkboxOn : ''}`} />
          <span>{t('inventory.localImport.includeMissingGuard')}</span>
        </button>
      )}

      {error && <p className={s.error}>{error}</p>}

      <div className={s.footer}>
        <button type="button" className={s.secondary} onClick={onCancel} disabled={busy}>
          {t('inventory.local.cancel')}
        </button>
        <button
          type="button"
          className={s.primary}
          onClick={onCommit}
          disabled={busy || total === 0}
        >
          {busy && <Loader2 size={14} className={s.spin} />}
          <span>{t('inventory.localImport.importBtn', { count: total })}</span>
        </button>
      </div>
    </div>
  );
};

import type {
  LocalAccountInput,
  LocalImportFile,
  LocalImportPreview,
  LocalServiceId,
} from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Fragment, useReducer, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LocalAccountForm } from '~/features/inventory/LocalAccountForm';
import { localErrorText } from '~/features/inventory/localErrors';
import { useInventoryFilters } from '~/stores/inventoryFilters';
import { useView } from '~/stores/view';
import { AuthKeysStep } from './AuthKeysStep';
import { CredentialsStep } from './CredentialsStep';
import s from './LocalImport.module.scss';
import { MafilesStep } from './MafilesStep';
import { type ImportMode, ModeStep } from './ModeStep';
import { type ImportResult, ReportStep } from './ReportStep';
import { ServiceStep } from './ServiceStep';

type Step = 'service' | 'mode' | 'single' | 'mafiles' | 'credentials' | 'authKeys' | 'report';

interface State {
  step: Step;
  service: LocalServiceId;
  mode: ImportMode;
  files: LocalImportFile[];
  text: string;
  /** Telegram: fallback for keys pasted without a `:<dc>` suffix. */
  dcId: number;
  /** Telegram: a base folder main reads itself. */
  dir: string | null;
  preview: LocalImportPreview | null;
  includeMissingGuard: boolean;
}

type Action =
  | { type: 'service'; service: LocalServiceId }
  | { type: 'mode'; mode: ImportMode }
  | { type: 'goto'; step: Step }
  | { type: 'addFiles'; files: LocalImportFile[] }
  | { type: 'clearFiles' }
  | { type: 'text'; text: string }
  | { type: 'dcId'; dcId: number }
  | { type: 'dir'; dir: string | null }
  /** The single-account form found a whole base — carry on in bulk. */
  | { type: 'bulkFrom'; dir: string }
  | { type: 'preview'; preview: LocalImportPreview }
  | { type: 'toggleMissingGuard' }
  | { type: 'back' };

const INITIAL: State = {
  step: 'service',
  service: 'steam',
  mode: 'bulk',
  files: [],
  text: '',
  dcId: 2,
  dir: null,
  preview: null,
  includeMissingGuard: false,
};

/** Where the header's back button goes; `null` means "leave the page". */
const previous = (state: State): Step | null => {
  switch (state.step) {
    case 'service':
      return null;
    case 'mode':
      return 'service';
    case 'single':
    case 'mafiles':
    case 'authKeys':
      return 'mode';
    case 'credentials':
      return 'mafiles';
    case 'report':
      return state.service === 'steam' ? 'credentials' : 'authKeys';
  }
};

/** The trail shown in the header, which depends on the branch taken. */
const crumbs = (state: State): Step[] => {
  const head: Step[] = ['service', 'mode'];
  if (state.step === 'service' || state.step === 'mode') return head;
  if (state.mode === 'single') return [...head, 'single'];
  return state.service === 'steam'
    ? [...head, 'mafiles', 'credentials', 'report']
    : [...head, 'authKeys', 'report'];
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'service':
      return { ...state, service: action.service, step: 'mode' };
    case 'mode':
      return {
        ...state,
        mode: action.mode,
        step:
          action.mode === 'single' ? 'single' : state.service === 'steam' ? 'mafiles' : 'authKeys',
      };
    case 'goto':
      return { ...state, step: action.step };
    // Dropping a second folder adds to the pile; the same file twice does not.
    case 'addFiles': {
      const seen = new Set(state.files.map((f) => f.name));
      return {
        ...state,
        files: [...state.files, ...action.files.filter((f) => !seen.has(f.name))],
      };
    }
    case 'clearFiles':
      return { ...state, files: [] };
    case 'text':
      return { ...state, text: action.text };
    case 'dcId':
      return { ...state, dcId: action.dcId };
    case 'dir':
      return { ...state, dir: action.dir };
    case 'bulkFrom':
      return { ...state, mode: 'bulk', dir: action.dir, step: 'authKeys' };
    // The checkbox on the report only makes sense when something was matched against nothing.
    case 'preview':
      return { ...state, preview: action.preview, step: 'report' };
    case 'toggleMissingGuard':
      return { ...state, includeMissingGuard: !state.includeMissingGuard };
    case 'back': {
      const step = previous(state);
      return step === null ? state : { ...state, step, preview: null };
    }
  }
};

export const LocalImportView = () => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const setView = useView((st) => st.setView);
  const setScope = useInventoryFilters((st) => st.setScope);

  const [state, dispatch] = useReducer(reducer, INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const leave = () => setView('inventory');

  /** Back to the grid, on the tab the new records landed in. */
  const finish = () => {
    setScope('local');
    setView('inventory');
  };

  const back = () => {
    setError(null);
    setResult(null);
    if (previous(state) === null) leave();
    else dispatch({ type: 'back' });
  };

  const analyze = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await window.launcher.localAccounts.importPreview({
      service: state.service,
      files: state.files,
      text: state.text,
      defaultDcId: state.dcId,
      ...(state.dir ? { dir: state.dir } : {}),
    });
    setBusy(false);
    if (res.ok) dispatch({ type: 'preview', preview: res.preview });
    else setError(localErrorText(t, res.message));
  };

  const commit = async () => {
    if (busy || !state.preview) return;
    setBusy(true);
    setError(null);
    const res = await window.launcher.localAccounts.importCommit(
      state.preview.token,
      state.includeMissingGuard,
    );
    setBusy(false);
    if (!res.ok) {
      setError(localErrorText(t, res.message));
      return;
    }
    await qc.invalidateQueries({ queryKey: ['accounts'] });
    // Nothing to explain when every record went in — go look at them.
    if (res.failed.length === 0) finish();
    else setResult({ created: res.created, failed: res.failed });
  };

  const submitSingle = async (input: LocalAccountInput) => {
    const res = await window.launcher.localAccounts.create(input);
    if (res.ok) await qc.invalidateQueries({ queryKey: ['accounts'] });
    return res.ok ? { ok: true } : { ok: false, message: res.message };
  };

  const trail = crumbs(state);

  return (
    <div className={s.page}>
      <div className={s.header}>
        <button type="button" className={s.back} onClick={back}>
          <ArrowLeft size={14} />
          <span>{t('inventory.localImport.back')}</span>
        </button>
        <h1 className={s.title}>{t('inventory.localImport.title')}</h1>
      </div>

      <div className={s.crumbs}>
        {trail.map((step, i) => (
          <Fragment key={step}>
            {i > 0 && (
              <span className={s.crumbSep} aria-hidden>
                ›
              </span>
            )}
            <span className={`${s.crumb} ${step === state.step ? s.crumbOn : ''}`}>
              {t(`inventory.localImport.steps.${step}`)}
            </span>
          </Fragment>
        ))}
      </div>

      {state.step === 'service' && (
        <ServiceStep onPick={(service) => dispatch({ type: 'service', service })} />
      )}

      {state.step === 'mode' && <ModeStep onPick={(mode) => dispatch({ type: 'mode', mode })} />}

      {state.step === 'single' && (
        <div className={s.formWrap}>
          <LocalAccountForm
            edit={null}
            initialService={state.service}
            lockService
            onCancel={back}
            onSubmit={submitSingle}
            onDone={finish}
            onBulkImport={(dir) => dispatch({ type: 'bulkFrom', dir })}
          />
        </div>
      )}

      {state.step === 'mafiles' && (
        <MafilesStep
          files={state.files}
          onAdd={(files) => dispatch({ type: 'addFiles', files })}
          onClear={() => dispatch({ type: 'clearFiles' })}
          onNext={() => dispatch({ type: 'goto', step: 'credentials' })}
        />
      )}

      {state.step === 'credentials' && (
        <CredentialsStep
          text={state.text}
          onText={(text) => dispatch({ type: 'text', text })}
          busy={busy}
          onAnalyze={() => void analyze()}
        />
      )}

      {state.step === 'authKeys' && (
        <AuthKeysStep
          text={state.text}
          onText={(text) => dispatch({ type: 'text', text })}
          dcId={state.dcId}
          onDcId={(dcId) => dispatch({ type: 'dcId', dcId })}
          dir={state.dir}
          onDir={(dir) => dispatch({ type: 'dir', dir })}
          busy={busy}
          onAnalyze={() => void analyze()}
        />
      )}

      {state.step === 'report' && state.preview && (
        <ReportStep
          preview={state.preview}
          includeMissingGuard={state.includeMissingGuard}
          onToggleMissingGuard={() => dispatch({ type: 'toggleMissingGuard' })}
          result={result}
          busy={busy}
          error={error}
          onCommit={() => void commit()}
          onCancel={back}
          onDone={finish}
        />
      )}

      {state.step !== 'report' && error && <p className={s.error}>{error}</p>}
    </div>
  );
};

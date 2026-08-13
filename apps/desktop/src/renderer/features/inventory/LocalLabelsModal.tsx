import type { AccountSummary, LocalLabel } from '@shared-types';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labelColors } from '~/lib/labelColor';
import { useLocalLabels } from '~/stores/localLabels';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalEmpty,
  ModalError,
  ModalIconButton,
  ModalInput,
  ModalNote,
  ModalOption,
  ModalStatus,
} from '~/widgets/Modal/ModalKit';
import s from './LocalLabelsModal.module.scss';
import { localErrorText } from './localErrors';

const PALETTE = [
  '#3083ff',
  '#00ba78',
  '#e0a106',
  '#e0533f',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#64748b',
] as const;

/** Matches `MAX_TITLE` in `main/accounts/label-store.ts`. */
const MAX_TITLE = 24;

interface LocalLabelsModalProps {
  item: AccountSummary;
  onClose: () => void;
  /** The account's labels changed on disk — the list has to be re-read. */
  onSaved: () => void;
}

export const LocalLabelsModal = ({ item, onClose, onSaved }: LocalLabelsModalProps) => {
  const { t } = useTranslation();
  const labels = useLocalLabels((st) => st.labels);
  const loading = useLocalLabels((st) => st.loading);
  const loadLabels = useLocalLabels((st) => st.load);
  const saveLabel = useLocalLabels((st) => st.save);
  const removeLabel = useLocalLabels((st) => st.remove);

  /** What the account wears right now, kept here so a tick answers instantly. */
  const [attached, setAttached] = useState<number[]>(() =>
    (item.tags ?? []).filter((tg) => tg.id < 0).map((tg) => tg.id),
  );
  const [busy, setBusy] = useState(false);
  /** `null` — closed, a negative id — editing that label, `'new'` — adding one. */
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [colour, setColour] = useState<string>(PALETTE[0]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  /** Writes the whole set, then tells the grid to re-read. */
  const commit = async (next: number[]): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const previous = attached;
    setAttached(next);
    try {
      const res = await window.launcher.localAccounts.setLabels(item.itemId, next);
      if (res.ok) onSaved();
      else {
        setAttached(previous);
        setError(localErrorText(t, res.message));
      }
    } catch {
      setAttached(previous);
      setError(t('inventory.card.callError'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (label: LocalLabel): void => {
    const next = attached.includes(label.id)
      ? attached.filter((id) => id !== label.id)
      : [...attached, label.id];
    void commit(next);
  };

  const startNew = (): void => {
    setEditing('new');
    setTitle('');
    setColour(PALETTE[0]);
    setError(null);
  };

  const startEdit = (label: LocalLabel): void => {
    setEditing(label.id);
    setTitle(label.title);
    setColour(label.bc);
    setError(null);
  };

  const submitEditor = async (): Promise<void> => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveLabel(editing === 'new' ? null : editing, title, colour);
      if (res.ok) {
        setEditing(null);
        setTitle('');
        // A rename changes what the cards show, so the grid re-reads too.
        onSaved();
      } else {
        setError(localErrorText(t, res.message));
      }
    } finally {
      setBusy(false);
    }
  };

  /** Deleting a definition leaves the id on whichever accounts wear it; it stops resolving. */
  const drop = async (label: LocalLabel): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await removeLabel(label.id);
      if (res.ok) {
        setAttached((prev) => prev.filter((id) => id !== label.id));
        if (editing === label.id) setEditing(null);
        onSaved();
      } else {
        setError(localErrorText(t, res.message));
      }
    } finally {
      setBusy(false);
    }
  };

  /** Name and colour, in place of the row being edited. */
  const editor = (
    <div className={s.editor}>
      <ModalInput
        value={title}
        maxLength={MAX_TITLE}
        spellCheck={false}
        // Редактор раскрыт ровно ради этого поля — курсор сразу в нём.
        autoFocus
        placeholder={t('settings.profile.labelTitlePlaceholder')}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submitEditor();
          // Гасим здесь, иначе Escape закроет весь диалог вместе с недописанным названием.
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(null);
          }
        }}
      />
      <div className={s.palette}>
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`${s.swatch} ${c === colour ? s.swatchOn : ''}`}
            style={{ backgroundColor: c }}
            aria-label={c}
            aria-pressed={c === colour}
            onClick={() => setColour(c)}
          />
        ))}
      </div>
      <div className={s.editorActions}>
        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
          {t('inventory.local.cancel')}
        </Button>
        <Button
          variant="accent"
          size="sm"
          busy={busy}
          disabled={!title.trim()}
          onClick={() => void submitEditor()}
        >
          {t('inventory.local.save')}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      title={t('inventory.card.localLabels.title')}
      subtitle={item.title}
      size="md"
      closable
      onClose={onClose}
      footer={
        <>
          <ModalNote>{t('inventory.card.localLabels.hint')}</ModalNote>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>

      {loading && labels.length === 0 ? (
        <ModalStatus tone="busy" title={t('inventory.card.localLabels.loading')} />
      ) : (
        labels.map((label) => {
          if (editing === label.id) return <div key={label.id}>{editor}</div>;
          const c = labelColors(label.bc);
          return (
            <ModalOption
              key={label.id}
              title={
                <span className={s.chip} style={{ backgroundColor: c.background, color: c.text }}>
                  {label.title}
                </span>
              }
              selected={attached.includes(label.id)}
              disabled={busy}
              onClick={() => toggle(label)}
              trailing={
                <>
                  <ModalIconButton
                    icon={Pencil}
                    label={t('settings.profile.labelEdit')}
                    disabled={busy}
                    onClick={() => startEdit(label)}
                  />
                  <ModalIconButton
                    icon={Trash2}
                    label={t('settings.profile.labelDelete')}
                    disabled={busy}
                    danger
                    onClick={() => void drop(label)}
                  />
                </>
              }
            />
          );
        })
      )}

      {editing === 'new' && editor}

      {!loading && labels.length === 0 && editing === null && (
        <ModalEmpty>{t('inventory.card.localLabels.empty')}</ModalEmpty>
      )}

      {editing === null && (
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          className={s.add}
          disabled={busy}
          onClick={startNew}
        >
          {t('inventory.card.localLabels.add')}
        </Button>
      )}
    </Modal>
  );
};

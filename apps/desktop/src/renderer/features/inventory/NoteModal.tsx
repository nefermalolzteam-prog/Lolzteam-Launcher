import type { AccountSummary } from '@shared-types';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalSpacer, ModalTextarea } from '~/widgets/Modal/ModalKit';
import s from './NoteModal.module.scss';

/** Matches `NOTE_MAX_LENGTH` in `main/services/market.ts`. */
const MAX_LENGTH = 1000;

/** Close to the cap, and only then, the counter starts saying so. */
const COUNTER_FROM = 800;

interface NoteModalProps {
  item: AccountSummary;
  onClose: () => void;
  /** The market accepted it — this is the text as it now stands there. */
  onSaved: (note: string | null) => void;
}

export const NoteModal = ({ item, onClose, onSaved }: NoteModalProps) => {
  const { t } = useTranslation();
  const [text, setText] = useState(item.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = item.note ?? '';
  const dirty = text.trim() !== current;

  const commit = async (next: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.launcher.accounts.setNote(item.itemId, next);
      if (res.ok) {
        onSaved(res.note);
        onClose();
      } else {
        setError(res.message);
      }
    } catch {
      setError(t('inventory.card.callError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('inventory.card.note.title')}
      subtitle={item.title}
      closable
      onClose={onClose}
      footer={
        <>
          {/* Only when there is something on the server to remove. */}
          {current !== '' && (
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              className={s.delete}
              disabled={busy}
              onClick={() => void commit('')}
            >
              {t('inventory.card.note.delete')}
            </Button>
          )}
          <ModalSpacer />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t('inventory.local.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={!dirty}
            onClick={() => void commit(text)}
          >
            {t('inventory.local.save')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalTextarea
        value={text}
        maxLength={MAX_LENGTH}
        rows={5}
        // Диалог открыт ровно ради этого поля — курсор сразу в нём.
        autoFocus
        disabled={busy}
        placeholder={t('inventory.card.note.placeholder')}
        className={s.input}
        onChange={(e) => setText(e.target.value)}
        // Ctrl+Enter is what every other multi-line box in the app saves.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && dirty) void commit(text);
        }}
      />
      <div className={s.meta}>
        <span className={s.hint}>{t('inventory.card.note.hint')}</span>
        {text.length >= COUNTER_FROM && (
          <span className={s.counter}>
            {text.length}/{MAX_LENGTH}
          </span>
        )}
      </div>
    </Modal>
  );
};

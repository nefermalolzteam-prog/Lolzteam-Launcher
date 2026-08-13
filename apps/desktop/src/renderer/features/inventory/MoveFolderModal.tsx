import type { AccountSummary, LocalServiceId } from '@shared-types';
import { isLocalServiceId } from '@shared-types';
import { FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalGroups } from '~/stores/localGroups';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalError,
  ModalGroup,
  ModalInput,
  ModalOption,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';
import { localErrorText } from './localErrors';

interface MoveFolderModalProps {
  item: AccountSummary;
  onClose: () => void;
  /** The account moved — the grid has to re-read, folders included. */
  onMoved: () => void;
}

export const MoveFolderModal = ({ item, onClose, onMoved }: MoveFolderModalProps) => {
  const { t } = useTranslation();
  const groups = useLocalGroups((st) => st.groups);
  const loadGroups = useLocalGroups((st) => st.load);

  const service: LocalServiceId | null = isLocalServiceId(item.category) ? item.category : null;
  const current = item.folder ?? '';

  const [picked, setPicked] = useState<string>(current);
  const [fresh, setFresh] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  /** The root, every folder main knows of, and the one the account sits in. */
  const options = useMemo(() => {
    const set = new Set<string>(service ? (groups[service] ?? []) : []);
    if (current) set.add(current);
    return ['', ...[...set].sort((a, b) => a.localeCompare(b))];
  }, [groups, service, current]);

  const target = fresh.trim() || picked;
  const unchanged = target === current;

  const submit = async (): Promise<void> => {
    if (busy || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      const res = await window.launcher.localAccounts.move(item.itemId, target);
      if (res.ok) {
        // The set of folders itself may have grown by one; the grid re-reads the accounts.
        await useLocalGroups.getState().refresh();
        onMoved();
        onClose();
      } else {
        setError(localErrorText(t, res.message));
      }
    } catch {
      setError(t('inventory.card.callError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('inventory.card.moveFolder.title')}
      size="sm"
      closable
      onClose={onClose}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t('inventory.local.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={unchanged}
            onClick={() => void submit()}
          >
            {t('inventory.card.moveFolder.submit')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>

      {options.map((group) => (
        <ModalOption
          key={group || ' root'}
          icon={FolderOpen}
          title={group || t('inventory.card.moveFolder.root')}
          // «Текущая» — подписью под названием, а не значком у правого края: справа стоит галка выбора.
          hint={group === current ? t('inventory.card.moveFolder.current') : undefined}
          selected={!fresh.trim() && group === picked}
          disabled={busy}
          onClick={() => {
            setFresh('');
            setPicked(group);
          }}
        />
      ))}

      {/* Пока в поле что-то есть, оно и есть назначение: выбор в списке выше гаснет, потому что папка у переезда одна. */}
      <ModalGroup>{t('inventory.card.moveFolder.newLabel')}</ModalGroup>
      <ModalInput
        value={fresh}
        maxLength={64}
        spellCheck={false}
        disabled={busy}
        placeholder={t('inventory.card.moveFolder.newPlaceholder')}
        onChange={(e) => setFresh(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
    </Modal>
  );
};

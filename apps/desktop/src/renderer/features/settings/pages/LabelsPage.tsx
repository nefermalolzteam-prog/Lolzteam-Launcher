import { type UserLabel, isEditableLabel } from '@shared-types';
import { GripVertical, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labelColors } from '~/lib/labelColor';
import { useProfileLabels } from '~/stores/profileLabels';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalError, ModalHint, ModalSpacer } from '~/widgets/Modal/ModalKit';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { LockIcon } from '~/widgets/icons/Icons';
import { LabelEditorModal } from '../LabelEditorModal';
import { SettingsPageActions } from '../pageActions';
import { PencilIcon, TrashIcon } from '../ui/SettingsIcons';
import s from './LabelsPage.module.scss';

const isCustom = (label: UserLabel) => label.id >= 4;

export const LabelsPage = () => {
  const { t } = useTranslation();
  const labels = useProfileLabels((p) => p.labels);
  const loading = useProfileLabels((p) => p.loading);
  const load = useProfileLabels((p) => p.load);
  const refresh = useProfileLabels((p) => p.refresh);
  const createLabel = useProfileLabels((p) => p.create);
  const updateLabel = useProfileLabels((p) => p.update);
  const removeLabel = useProfileLabels((p) => p.remove);
  const reorder = useProfileLabels((p) => p.reorder);

  const [editing, setEditing] = useState<UserLabel | 'new' | null>(null);
  const [deleting, setDeleting] = useState<UserLabel | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = labels.filter(isCustom);
  const editable = shown.filter(isEditableLabel);

  const persistOrder = async (orderedEditable: UserLabel[]) => {
    let ci = 0;
    const fullOrder = labels.map((l) =>
      isEditableLabel(l) ? (orderedEditable[ci++]?.id ?? l.id) : l.id,
    );
    setBusy(true);
    await reorder(fullOrder);
    setBusy(false);
  };

  const handleDrop = async (targetId: number) => {
    const from = dragId;
    setDragId(null);
    setOverId(null);
    if (from === null || from === targetId || busy) return;
    const fromIdx = editable.findIndex((l) => l.id === from);
    const toIdx = editable.findIndex((l) => l.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...editable];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    await persistOrder(next);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const res = await removeLabel(deleting.id);
    setDeleteBusy(false);
    if (res.ok) setDeleting(null);
    else setDeleteError(res.message ?? t('settings.profile.labelDeleteFailed'));
  };

  return (
    <>
      <SettingsPageActions>
        <button
          type="button"
          className={s.refreshBtn}
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? <Loader2 size={14} className={s.spin} /> : <RefreshCw size={14} />}
          <span>{t('settings.profile.refresh')}</span>
        </button>
        <button type="button" className={s.createBtn} onClick={() => setEditing('new')}>
          {t('settings.profile.labelNew')}
        </button>
      </SettingsPageActions>

      <div className={s.labelsBlock}>
        {shown.length === 0 ? (
          <p className={s.empty}>
            {loading ? t('settings.profile.loading') : t('settings.profile.empty')}
          </p>
        ) : (
          <ul className={s.list}>
            {shown.map((label) => {
              const c = labelColors(label.bc);
              const locked = !isEditableLabel(label);
              if (locked) {
                return (
                  <li key={label.id} className={`${s.row} ${s.rowLocked}`}>
                    {/* Замок — картинка к тексту справа, а не самостоятельный знак: причина написана в строке словами. */}
                    <span className={s.lockHandle} aria-hidden>
                      <LockIcon size={14} />
                    </span>
                    <span
                      className={s.chip}
                      style={{ backgroundColor: c.background, color: c.text }}
                    >
                      {label.title}
                    </span>
                    <span className={s.lockedHint}>{t('settings.profile.labelLocked')}</span>
                  </li>
                );
              }
              return (
                <li
                  key={label.id}
                  className={`${s.row} ${dragId === label.id ? s.rowDragging : ''} ${
                    overId === label.id && dragId !== null && dragId !== label.id ? s.rowOver : ''
                  }`}
                  draggable={!busy}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(label.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragOver={(e) => {
                    if (dragId === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (overId !== label.id) setOverId(label.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleDrop(label.id);
                  }}
                >
                  <span className={s.dragHandle} aria-hidden>
                    <GripVertical size={15} />
                  </span>
                  <span className={s.chip} style={{ backgroundColor: c.background, color: c.text }}>
                    {label.title}
                  </span>
                  <div className={s.rowActions}>
                    {busy && dragId === null && <Loader2 size={14} className={s.spin} />}
                    <Tooltip label={t('settings.profile.labelEdit')}>
                      <button
                        type="button"
                        className={s.iconBtn}
                        onClick={() => setEditing(label)}
                        aria-label={t('settings.profile.labelEdit')}
                        disabled={busy}
                      >
                        <PencilIcon size={15} />
                      </button>
                    </Tooltip>
                    <Tooltip label={t('settings.profile.labelDelete')}>
                      <button
                        type="button"
                        className={`${s.iconBtn} ${s.iconBtnDanger}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(label);
                        }}
                        aria-label={t('settings.profile.labelDelete')}
                        disabled={busy}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </Tooltip>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && (
        <LabelEditorModal
          label={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={(title, bc) =>
            editing === 'new' ? createLabel(title, bc) : updateLabel(editing.id, title, bc)
          }
        />
      )}

      {deleting && (
        <Modal
          title={t('settings.profile.labelDelete')}
          subtitle={deleting.title}
          size="sm"
          closable={!deleteBusy}
          onClose={deleteBusy ? undefined : () => setDeleting(null)}
          footer={
            <>
              <ModalSpacer />
              <Button
                variant="ghost"
                size="sm"
                disabled={deleteBusy}
                onClick={() => setDeleting(null)}
              >
                {t('settings.profile.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                busy={deleteBusy}
                onClick={() => void confirmDelete()}
              >
                {t('settings.profile.labelDelete')}
              </Button>
            </>
          }
        >
          <ModalHint>
            {t('settings.profile.labelDeleteConfirm', { title: deleting.title })}
          </ModalHint>
          <ModalError>{deleteError}</ModalError>
        </Modal>
      )}
    </>
  );
};

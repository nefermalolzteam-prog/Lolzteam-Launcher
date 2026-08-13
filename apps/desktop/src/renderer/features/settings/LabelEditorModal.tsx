import type { UserLabel } from '@shared-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { labelColors } from '~/lib/labelColor';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalError,
  ModalField,
  ModalGroup,
  ModalInput,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';
import s from './LabelEditorModal.module.scss';

const PRESET_COLORS = [
  '#3083ff',
  '#00ba78',
  '#e0a106',
  '#e0533f',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#64748b',
];

const MAX_TITLE = 16;
const DEFAULT_COLOR = '#3083ff';

interface LabelEditorModalProps {
  label: UserLabel | null;
  onClose: () => void;
  onSubmit: (title: string, bc: string) => Promise<{ ok: boolean; message?: string }>;
}

/** Метка форума: название, цвет и то, как она будет выглядеть. */
export const LabelEditorModal = ({ label, onClose, onSubmit }: LabelEditorModalProps) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState(label?.title ?? '');
  const [color, setColor] = useState(() => {
    const c = labelColors(label?.bc);
    return c.background.startsWith('#') ? c.background : DEFAULT_COLOR;
  });
  const [colorTouched, setColorTouched] = useState(false);
  const pickColor = (c: string) => {
    setColor(c);
    setColorTouched(true);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = title.trim();
  const valid = trimmed.length > 0;
  const submitColor = !colorTouched && label?.bc ? label.bc : color;
  const preview = labelColors(submitColor);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await onSubmit(trimmed.slice(0, MAX_TITLE), submitColor);
    if (res.ok) {
      onClose();
    } else {
      setError(res.message ?? t('settings.profile.labelSaveFailed'));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={label ? t('settings.profile.labelEdit') : t('settings.profile.labelNew')}
      size="sm"
      closable={!busy}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t('settings.profile.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={!valid}
            onClick={() => void submit()}
          >
            {t('settings.profile.save')}
          </Button>
        </>
      }
    >
      {/* `<form>` ради Enter: кнопка сохранения живёт в футере каркаса, то есть вне этого дерева. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className={s.previewRow}>
          <span
            className={s.preview}
            style={{ backgroundColor: preview.background, color: preview.text }}
          >
            {trimmed || t('settings.profile.labelTitlePlaceholder')}
          </span>
        </div>

        <ModalField label={t('settings.profile.labelTitle')}>
          {/* Счётчик поверх поля, а не под ним: он про то же самое, что и `maxLength`, и своей строки под собой не стоит. */}
          <span className={s.inputWrap}>
            <ModalInput
              className={s.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE}
              placeholder={t('settings.profile.labelTitlePlaceholder')}
              spellCheck={false}
              disabled={busy}
              autoFocus
            />
            <span className={s.counter}>
              {trimmed.length}/{MAX_TITLE}
            </span>
          </span>
        </ModalField>

        {/* `<ModalGroup/>`, а не `<ModalField/>`: обернуть `<label>`-ом девять кнопок нельзя — подпись досталась бы первой из них. */}
        <ModalGroup>{t('settings.profile.labelColor')}</ModalGroup>
        <div className={s.colorRow}>
          <input
            type="color"
            className={s.colorInput}
            value={color}
            onChange={(e) => pickColor(e.target.value)}
            disabled={busy}
            aria-label={t('settings.profile.labelColor')}
          />
          <div className={s.swatches}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${s.swatch} ${color.toLowerCase() === c ? s.swatchOn : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => pickColor(c)}
                disabled={busy}
                aria-label={c}
                aria-pressed={color.toLowerCase() === c}
              />
            ))}
          </div>
        </div>

        <ModalError>{error}</ModalError>
      </form>
    </Modal>
  );
};

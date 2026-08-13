import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '~/widgets/Button/Button';
import { Flag } from '~/widgets/Flag/Flag';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalGrid, ModalHint, ModalOption, ModalSpacer } from '~/widgets/Modal/ModalKit';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from './SettingsControls.module.scss';
import { ChevronRightIcon } from './SettingsIcons';

export type Tone = 'muted' | 'good' | 'warn';

const TONE: Record<Tone, string | undefined> = {
  muted: s.description,
  good: s.descriptionGood,
  warn: s.descriptionWarn,
};

interface RowText {
  title: string;
  description?: ReactNode;
  tone?: Tone;
  alert?: string | null;
  /** Сжать описание в одну строку с многоточием. */
  truncate?: boolean;
}

const RowBody = ({ title, description, tone = 'muted', alert, truncate }: RowText) => (
  <span className={s.body}>
    <span className={s.title}>{title}</span>
    {description !== undefined && description !== null && description !== '' && (
      <span className={`${TONE[tone]} ${truncate ? s.descriptionTruncate : ''}`}>
        {description}
      </span>
    )}
    {alert && <span className={s.alert}>{alert}</span>}
  </span>
);

interface SettingGroupProps {
  label?: string;
  children: ReactNode;
}

export const SettingGroup = ({ label, children }: SettingGroupProps) => (
  <section className={s.group}>
    {label && <h3 className={s.groupLabel}>{label}</h3>}
    <div className={s.groupRows}>{children}</div>
  </section>
);

/** Строка карточки, в которой нечего нажимать: оговорка, ответ сервера, «почему это выключено». */
export const SettingNote = ({ children }: { children: ReactNode }) => (
  <p className={s.note}>{children}</p>
);

interface SettingRowProps extends RowText {
  children?: ReactNode;
  /** Положить управление под текстом, а не справа от него. */
  stack?: boolean;
}

export const SettingRow = ({ children, stack, ...text }: SettingRowProps) => (
  <div className={`${s.row} ${stack ? s.rowStack : ''}`}>
    <RowBody {...text} />
    {children && <div className={s.control}>{children}</div>}
  </div>
);

interface SettingActionProps extends RowText {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: LucideIcon;
  danger?: boolean;
}

export const SettingAction = ({
  onClick,
  disabled,
  busy,
  icon: Icon = ArrowRight,
  danger,
  ...text
}: SettingActionProps) => (
  <button
    type="button"
    className={`${s.row} ${s.rowButton}`}
    onClick={onClick}
    disabled={disabled || busy}
  >
    <RowBody {...text} />
    <span className={`${s.trailingIcon} ${danger ? s.trailingIconDanger : ''}`}>
      {busy ? <Loader2 size={20} className={s.spin} /> : <Icon size={20} />}
    </span>
  </button>
);

interface SettingToggleProps extends RowText {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export const SettingToggle = ({ checked, onChange, disabled, ...text }: SettingToggleProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    className={`${s.row} ${s.rowButton}`}
    onClick={onChange}
    disabled={disabled}
  >
    <RowBody {...text} />
    <span className={`${s.switch} ${checked ? s.switchOn : ''}`}>
      <span className={s.switchKnob} />
    </span>
  </button>
);

export interface SegmentedOption<T> {
  value: T;
  label: string;
  title?: string;
}

/** Ряд сегментов внутри строки. */
interface SettingSegmentedProps<T> extends RowText {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export const SettingSegmented = <T extends string | number>({
  options,
  value,
  onChange,
  ...text
}: SettingSegmentedProps<T>) => (
  <div className={s.row}>
    <RowBody {...text} />
    <div className={s.segmented}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          className={`${s.segmentBtn} ${opt.value === value ? s.segmentBtnActive : ''}`}
          onClick={() => onChange(opt.value)}
          {...(opt.title ? { title: opt.title } : {})}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

/** Строка-выбор: слева название, справа текущее значение и стрелка. */
export interface ChoiceOption<T> {
  value: T;
  label: string;
  /** Пояснение под подписью — видно только в модалке. */
  hint?: string;
}

interface SettingChoiceProps<T> extends RowText {
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Заголовок модалки; по умолчанию — название самой настройки. */
  modalTitle?: string;
  /** Разложить варианты в две колонки. */
  columns?: 1 | 2;
  disabled?: boolean;
}

export const SettingChoice = <T extends string | number>({
  options,
  value,
  onChange,
  modalTitle,
  columns = 1,
  disabled,
  ...text
}: SettingChoiceProps<T>) => {
  const [open, setOpen] = useState(false);
  const current = options.find((opt) => opt.value === value);
  const title = modalTitle ?? text.title;

  const list = options.map((opt) => (
    <ModalOption
      key={String(opt.value)}
      title={opt.label}
      hint={opt.hint}
      selected={opt.value === value}
      onClick={() => {
        setOpen(false);
        // Выбор того же значения — тоже закрытие, но не запись: настройки пишутся в файл, и лишний круг тут ни к чему.
        if (opt.value !== value) onChange(opt.value);
      }}
    />
  ));

  return (
    <>
      <button
        type="button"
        className={`${s.row} ${s.rowButton}`}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
      >
        <RowBody {...text} />
        <span className={s.control}>
          <span className={s.value}>{current?.label ?? ''}</span>
          <span className={s.trailingIcon}>
            <ChevronRightIcon size={20} />
          </span>
        </span>
      </button>

      {open && (
        /* Без футера: диалог закрывает сам выбор, а рядом с ним крестик. */
        <Modal
          title={title}
          size={columns === 2 ? 'md' : 'sm'}
          closable
          onClose={() => setOpen(false)}
        >
          {columns === 2 ? <ModalGrid>{list}</ModalGrid> : list}
        </Modal>
      )}
    </>
  );
};

interface SettingInputProps extends RowText {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric';
}

export const SettingInput = ({
  value,
  onChange,
  placeholder,
  inputMode = 'text',
  ...text
}: SettingInputProps) => (
  <div className={s.row}>
    <RowBody {...text} />
    <input
      className={s.input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode={inputMode}
      spellCheck={false}
      {...(placeholder ? { placeholder } : {})}
    />
  </div>
);

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
}

export const SettingIconButton = ({
  icon: Icon,
  label,
  onClick,
  disabled,
  busy,
  danger,
}: IconButtonProps) => {
  const off = disabled || busy;

  const button = (
    <button
      type="button"
      className={`${s.iconBtn} ${danger ? s.iconBtnDanger : ''}`}
      onClick={onClick}
      disabled={off}
      aria-label={label}
    >
      {busy ? <Loader2 size={17} className={s.spin} /> : <Icon size={17} />}
    </button>
  );

  /* Выключенная кнопка не шлёт `mouseenter` — подсказка пропала бы ровно там, где она нужнее всего: у кнопки. */
  return (
    <Tooltip label={label}>
      {off ? <span className={s.iconBtnHost}>{button}</span> : button}
    </Tooltip>
  );
};

export const FlagValue = ({ code, children }: { code?: string; children: ReactNode }) => (
  <>
    {code && <Flag code={code} className={s.flag} />}
    <span>{children}</span>
  </>
);

export interface ConfirmAction {
  label: string;
  onClick: () => void;
  variant?: 'neutral' | 'danger';
}

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  cancelLabel: string;
  onClose: () => void;
  actions: readonly ConfirmAction[];
  busy?: boolean;
}

/** «Точно?» — вопрос, отмена и одно-два действия. */
export const ConfirmDialog = ({
  title,
  body,
  cancelLabel,
  onClose,
  actions,
  busy,
}: ConfirmDialogProps) => (
  <Modal
    title={title}
    size="sm"
    closable={!busy}
    onClose={busy ? undefined : onClose}
    footer={
      <>
        <ModalSpacer />
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {cancelLabel}
        </Button>
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant === 'danger' ? 'danger' : 'accent'}
            size="sm"
            // Вертушка — только когда действие одно: с двумя непонятно, какое из них в пути, и крутились бы обе.
            busy={busy === true && actions.length === 1}
            disabled={busy}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </>
    }
  >
    <ModalHint>{body}</ModalHint>
  </Modal>
);

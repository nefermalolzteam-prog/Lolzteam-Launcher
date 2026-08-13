import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Loader2,
  type LucideIcon,
  Minus,
  Search,
  TriangleAlert,
} from 'lucide-react';
import {
  type ComponentPropsWithRef,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon } from '~/widgets/icons/Icons';
import s from './ModalKit.module.scss';

const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

/** Пустой узел — не «нет подписи», а «подписи нет вовсе»: её место не занимают. */
const blank = (node: ReactNode): boolean => node === null || node === undefined || node === '';

/* ── Строка выбора ─────────────────────────────────────────────────────────── */

/** Что строка делает с правым краем. */
export type ModalOptionAction = 'pick' | 'go' | 'none';

interface ModalOptionProps {
  /** Слева. Компонент lucide, а не готовый узел: размер и цвет задаёт кит. */
  icon?: LucideIcon;
  /** Кружок цвета вместо иконки — метка узнаётся по нему, а не по названию. */
  swatch?: string;
  /** Слева, когда слева не иконка: флаг страны, аватар, логотип сервиса. */
  leading?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** Строка уже что-то делает: вместо галки — вертушка. */
  busy?: boolean;
  action?: ModalOptionAction;
  /** Правый край: кнопки правки и удаления, счётчик, что угодно. */
  trailing?: ReactNode;
  /** Без него строка — не кнопка, а просто строка. */
  onClick?: () => void;
  /** Что показать под курсором: полный путь, ответ разборщика, причина отказа. */
  tooltip?: string;
}

export const ModalOption = ({
  icon: Icon,
  swatch,
  leading,
  title,
  hint,
  selected = false,
  disabled = false,
  busy = false,
  action = 'pick',
  trailing,
  onClick,
  tooltip,
}: ModalOptionProps) => {
  const face = (
    <>
      {Icon ? <Icon size={17} className={s.optionIcon} aria-hidden /> : null}
      {swatch !== undefined && (
        <span className={s.optionSwatch} style={{ background: swatch }} aria-hidden />
      )}
      {leading}
      <span className={s.optionText}>
        <span className={s.optionTitle}>{title}</span>
        {!blank(hint) && <small className={s.optionHint}>{hint}</small>}
      </span>
      {busy && <Loader2 size={16} className={cx(s.optionIcon, s.optionSpin)} aria-hidden />}
      {!busy && action === 'pick' && <Check size={16} className={s.tick} aria-hidden />}
      {!busy && action === 'go' && <ArrowRight size={16} className={s.arrow} aria-hidden />}
    </>
  );

  const className = cx(
    s.option,
    onClick && trailing === undefined && s.optionClickable,
    selected && s.optionSelected,
  );

  const pressed = action === 'pick' ? selected : undefined;

  // Строка целиком — одна кнопка: ничего, кроме неё, в строке нет.
  if (onClick && trailing === undefined) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled || busy}
        aria-pressed={pressed}
        aria-busy={busy || undefined}
        title={tooltip}
        onClick={onClick}
      >
        {face}
      </button>
    );
  }

  return (
    <div className={className} title={tooltip}>
      {onClick ? (
        <button
          type="button"
          className={s.optionHit}
          disabled={disabled || busy}
          aria-pressed={pressed}
          aria-busy={busy || undefined}
          onClick={onClick}
        >
          {face}
        </button>
      ) : (
        face
      )}
      {trailing !== undefined && <span className={s.optionTrailing}>{trailing}</span>}
    </div>
  );
};

/** Заголовок группы строк: «Папка «1»», «Без папки». */
export const ModalGroup = ({ children }: { children: ReactNode }) => (
  <div className={s.group}>{children}</div>
);

/** Блок «заголовок + строки под ним». */
export const ModalSection = ({ children }: { children: ReactNode }) => (
  <div className={s.section}>{children}</div>
);

/** Строки в две колонки. */
export const ModalGrid = ({ children }: { children: ReactNode }) => (
  <div className={s.grid}>{children}</div>
);

/* ── Поиск ─────────────────────────────────────────────────────────────────── */

interface ModalSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
}

export const ModalSearch = ({
  value,
  onChange,
  placeholder,
  autoFocus,
  'aria-label': ariaLabel,
}: ModalSearchProps) => (
  <div className={s.search}>
    <Search size={15} className={s.searchIcon} aria-hidden />
    <input
      className={s.searchInput}
      type="search"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      // Фокус по требованию вызывающего: в диалоге, открытом ради поиска, он и есть первое, куда пойдёт рука.
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

/* ── Поля ──────────────────────────────────────────────────────────────────── */

export const ModalInput = ({ className, ...rest }: ComponentPropsWithRef<'input'>) => (
  <input {...rest} className={cx(s.field, className)} />
);

export const ModalTextarea = ({ className, ...rest }: ComponentPropsWithRef<'textarea'>) => (
  <textarea {...rest} className={cx(s.field, className)} />
);

/** Строка списка, раскрываемого полем. */
export interface ModalSelectItem {
  value: string;
  label: ReactNode;
  /** Заголовок над строкой — папка прокси, раздел настроек. */
  group?: string;
  disabled?: boolean;
}

/** Ближайшая доступная строка от `from` включительно, шагом `dir`; -1 — нет такой. */
const reachable = (items: ModalSelectItem[], from: number, dir: 1 | -1): number => {
  for (let i = from; i >= 0 && i < items.length; i += dir) {
    if (!items[i]?.disabled) return i;
  }
  return -1;
};

interface ModalSelectProps {
  value: string;
  onChange: (value: string) => void;
  items: ModalSelectItem[];
  /** Что написано на кнопке, пока `value` не совпал ни с одной строкой. */
  placeholder?: ReactNode;
  disabled?: boolean;
  /** Когда поле без подписи: `<ModalField/>` даёт имя кнопке сам, своим `<label>`. */
  'aria-label'?: string;
  className?: string;
}

/** Зазор между кнопкой и списком, отступ от края окна и границы высоты списка. */
const SELECT_GAP = 6;
const SELECT_EDGE = 8;
const SELECT_MIN_HEIGHT = 120;
const SELECT_MAX_HEIGHT = 280;
/** Высота строки, заголовка группы и собственных полей панели — по разметке ниже. */
const SELECT_ROW = 36;
const SELECT_HEAD = 30;
const SELECT_PAD = 14;

interface SelectBox {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  up: boolean;
}

/** Выбор одного из многих, когда список — не разговор, а поле формы. */
export const ModalSelect = ({
  value,
  onChange,
  items,
  placeholder,
  disabled = false,
  'aria-label': ariaLabel,
  className,
}: ModalSelectProps) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<SelectBox | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = items.find((item) => item.value === value);

  // Во что список вырастет, если места хватит: по нему выбирается сторона.
  const groups = new Set(items.map((item) => item.group).filter(Boolean)).size;
  const wanted = Math.min(
    SELECT_MAX_HEIGHT,
    items.length * SELECT_ROW + groups * SELECT_HEAD + SELECT_PAD,
  );

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - SELECT_GAP - SELECT_EDGE;
    const above = r.top - SELECT_GAP - SELECT_EDGE;
    // Вниз по умолчанию — туда же, куда смотрит стрелка.
    const up = wanted > below && above > below;
    const room = Math.max(up ? above : below, SELECT_MIN_HEIGHT);
    setBox({
      left: r.left,
      width: r.width,
      ...(up
        ? { bottom: window.innerHeight - r.top + SELECT_GAP }
        : { top: r.bottom + SELECT_GAP }),
      maxHeight: Math.min(wanted, room),
      up,
    });
  }, [wanted]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Прокрутка любого предка — тела диалога в том числе, — поэтому с перехватом: событие прокрутки не всплывает.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  /** Щелчок мимо закрывает список — и на этом заканчивается. */
  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('click', onClickAway, true);
    return () => document.removeEventListener('click', onClickAway, true);
  }, [open]);

  // Строку под клавишами видно: иначе стрелка вниз уезжает за нижний край списка и выбор идёт вслепую.
  useEffect(() => {
    if (!open) return;
    popupRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => {
    const at = items.findIndex((item) => item.value === value);
    setActive(at >= 0 ? at : reachable(items, 0, 1));
    setOpen(true);
  };

  const step = (dir: 1 | -1) => {
    setActive((cur) => {
      const next = reachable(items, cur + dir, dir);
      // По кругу: в списке прокси последняя строка и первая — соседи не меньше, чем любые две другие.
      return next >= 0 ? next : reachable(items, dir === 1 ? 0 : items.length - 1, dir);
    });
  };

  const commit = (item: ModalSelectItem) => {
    if (item.disabled) return;
    if (item.value !== value) onChange(item.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        // Esc закрывает список, а не диалог: `Modal` слушает то же событие на окне, и без этого одно нажатие убирало бы сразу оба.
        e.stopPropagation();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        step(-1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(reachable(items, 0, 1));
        break;
      case 'End':
        e.preventDefault();
        setActive(reachable(items, items.length - 1, -1));
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const item = items[active];
        if (item) commit(item);
        break;
      }
    }
  };

  return (
    <span className={s.selectWrap} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(s.field, s.select, open && s.selectOpen, className)}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={cx(s.selectValue, current === undefined && s.selectEmpty)}>
          {current ? current.label : placeholder}
        </span>
      </button>
      <ChevronDown className={cx(s.selectArrow, open && s.selectArrowUp)} size={16} aria-hidden />
      {open &&
        box &&
        createPortal(
          <div
            ref={popupRef}
            id={listId}
            role="listbox"
            // Список — не остановка для Tab: он открыт ровно столько, сколько длится выбор, а кольцо всё это время на кнопке.
            tabIndex={-1}
            className={cx(s.selectPopup, box.up && s.selectPopupUp)}
            style={{
              left: box.left,
              width: box.width,
              top: box.top,
              bottom: box.bottom,
              maxHeight: box.maxHeight,
            }}
            // Одним обработчиком на всю панель: отмена срабатывает и для строк под ней.
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.map((item, i) => (
              <Fragment key={item.value}>
                {item.group !== undefined && item.group !== items[i - 1]?.group && (
                  <div className={s.selectGroup} role="presentation">
                    {item.group}
                  </div>
                )}
                <button
                  type="button"
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={item.value === value}
                  tabIndex={-1}
                  disabled={item.disabled}
                  className={cx(
                    s.selectItem,
                    i === active && s.selectItemActive,
                    item.value === value && s.selectItemPicked,
                  )}
                  // Наведение ведёт ту же строку, что и стрелки: «текущая» строка в списке одна.
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(item)}
                >
                  <span className={s.selectItemLabel}>{item.label}</span>
                  {item.value === value && <Check size={16} className={s.selectTick} aria-hidden />}
                </button>
              </Fragment>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
};

interface ModalFieldProps {
  label?: ReactNode;
  /** Под полем: что тут ждут и чем обернётся пустое место. */
  note?: ReactNode;
  children: ReactNode;
}

/** Поле с подписью. */
export const ModalField = ({ label, note, children }: ModalFieldProps) => (
  // biome-ignore lint/a11y/noLabelWithoutControl: контрол приходит как `children`, и статически это не видно
  <label className={s.fieldRow}>
    {!blank(label) && <span className={s.fieldLabel}>{label}</span>}
    {children}
    {!blank(note) && <small className={s.fieldNote}>{note}</small>}
  </label>
);

/* ── Текст ─────────────────────────────────────────────────────────────────── */

/** Пояснение в теле — перед тем, к чему относится. */
export const ModalHint = ({ children }: { children: ReactNode }) => (
  <p className={s.hint}>{children}</p>
);

/** Пояснение в футере: занимает всё, что осталось от кнопок. */
export const ModalNote = ({ children }: { children: ReactNode }) => (
  <span className={s.note}>{children}</span>
);

/** Разводит разрушающую кнопку и главную по разным краям футера. */
export const ModalSpacer = () => <span className={s.spacer} />;

/** Что пошло не так. */
export const ModalError = ({ children }: { children: ReactNode }) =>
  blank(children) ? null : (
    <p className={cx(s.notice, s.noticeBad)} role="alert">
      <CircleX size={18} aria-hidden />
      <span>{children}</span>
    </p>
  );

/** О чём стоит знать до нажатия — но что нажать не мешает. */
export const ModalWarn = ({ children }: { children: ReactNode }) =>
  blank(children) ? null : (
    <p className={cx(s.notice, s.noticeWarn)}>
      <AlertIcon size={18} aria-hidden />
      <span>{children}</span>
    </p>
  );

/** Списку нечего показать. */
export const ModalEmpty = ({ children }: { children: ReactNode }) => (
  <p className={s.empty}>{children}</p>
);

/* ── Исход действия ────────────────────────────────────────────────────────── */

/** Чем кончилось то, ради чего окно открыли: проверка, копирование, привязка. */
export type ModalStatusTone = 'busy' | 'ok' | 'warn' | 'bad';

const STATUS_ICON: Record<ModalStatusTone, LucideIcon> = {
  busy: Loader2,
  ok: CircleCheck,
  warn: TriangleAlert,
  bad: CircleX,
};

const STATUS_CLASS: Record<ModalStatusTone, string | undefined> = {
  busy: s.statusBusy,
  ok: s.statusOk,
  warn: s.statusWarn,
  bad: s.statusBad,
};

interface ModalStatusProps {
  tone: ModalStatusTone;
  title: ReactNode;
  /** Причина, ответ сервера, что делать дальше — под заголовком и тише его. */
  hint?: ReactNode;
}

export const ModalStatus = ({ tone, title, hint }: ModalStatusProps) => {
  const Icon = STATUS_ICON[tone];
  return (
    <div className={s.status} role={tone === 'busy' ? 'status' : undefined}>
      <Icon
        size={30}
        className={cx(s.statusIcon, STATUS_CLASS[tone], tone === 'busy' && s.statusSpin)}
        aria-hidden
      />
      <p className={s.statusTitle}>{title}</p>
      {!blank(hint) && <p className={s.statusHint}>{hint}</p>}
    </div>
  );
};

/* ── Флажок ────────────────────────────────────────────────────────────────── */

/** Столбик флажков. */
export const ModalChecks = ({ children }: { children: ReactNode }) => (
  <div className={s.checks}>{children}</div>
);

interface ModalCheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Отмечена часть того, за что отвечает флажок. */
  indeterminate?: boolean;
  /** Чем это обернётся — строкой под подписью. */
  hint?: ReactNode;
  /** Уточняет флажок над собой, а не стоит с ним рядом. */
  nested?: boolean;
  children: ReactNode;
}

export const ModalCheck = ({
  checked,
  onChange,
  disabled = false,
  indeterminate = false,
  hint,
  nested = false,
  children,
}: ModalCheckProps) => {
  const ref = useRef<HTMLInputElement>(null);

  // Третьего состояния у разметки нет — оно только свойство узла, поэтому и ставится после каждого рендера, а не атрибутом.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={cx(s.check, !blank(hint) && s.checkStacked, nested && s.checkNested)}>
      <input
        ref={ref}
        type="checkbox"
        className={s.checkInput}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={s.checkBox} aria-hidden>
        {indeterminate ? <Minus size={11} strokeWidth={3} /> : <Check size={11} strokeWidth={3} />}
      </span>
      {blank(hint) ? (
        children
      ) : (
        <span className={s.checkText}>
          <span>{children}</span>
          <small className={s.checkHint}>{hint}</small>
        </span>
      )}
    </label>
  );
};

/* ── Пилюли ────────────────────────────────────────────────────────────────── */

/** Ряд коротких значений, из которых выбирают одно: пол, язык, формат, папка. */
export const ModalChips = ({ children }: { children: ReactNode }) => (
  <div className={s.chips}>{children}</div>
);

interface ModalChipProps {
  label: ReactNode;
  /** Слева от подписи: стрелка направления сортировки, глиф сервиса. */
  icon?: LucideIcon;
  /** Сколько за ней стоит — число справа, тише подписи. */
  count?: number;
  /** `undefined` — пилюля не про состояние, а про действие: пресет приватности применяется и ничего не запоминает. */
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export const ModalChip = ({
  label,
  icon: Icon,
  count,
  selected,
  disabled = false,
  onClick,
}: ModalChipProps) => (
  <button
    type="button"
    className={cx(s.chip, selected && s.chipOn)}
    disabled={disabled}
    aria-pressed={selected}
    onClick={onClick}
  >
    {Icon ? <Icon size={13} aria-hidden /> : null}
    <span>{label}</span>
    {count !== undefined && <span className={s.chipCount}>{count}</span>}
  </button>
);

/* ── Круглая кнопка-иконка ─────────────────────────────────────────────────── */

interface ModalIconButtonProps {
  icon: LucideIcon;
  /** И подпись для скринридера, и подсказка под курсором. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export const ModalIconButton = ({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  danger = false,
}: ModalIconButtonProps) => (
  <button
    type="button"
    className={cx(s.iconButton, danger && s.iconButtonDanger)}
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
  >
    <Icon size={15} aria-hidden />
  </button>
);

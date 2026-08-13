import {
  AlertTriangle,
  Boxes,
  Check,
  Download,
  ListChecks,
  LogIn,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '~/lib/useDismiss';
import {
  type Task,
  type TaskChild,
  type TaskKind,
  orderedTasks,
  overallFraction,
  taskFraction,
  useTasks,
} from '~/stores/tasks';
import s from './TaskDock.module.scss';

const ICON: Record<TaskKind, typeof Boxes> = {
  accounts: Boxes,
  run: ListChecks,
  login: LogIn,
  update: Download,
  proxy: ShieldCheck,
};

const RADIUS = 25;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** `mm:ss`, or `h:mm:ss` once a run has been going for an hour. */
const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  // Two digits either way, so the pill does not change width at the tenth minute.
  const minutes = String(total >= 3600 ? Math.floor(total / 60) % 60 : Math.floor(total / 60));
  return total >= 3600
    ? `${Math.floor(total / 3600)}:${minutes.padStart(2, '0')}:${seconds}`
    : `${minutes.padStart(2, '0')}:${seconds}`;
};

/** Ticks once a second while there is something to time, and not otherwise. */
const useElapsed = (from: number | null): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (from === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [from]);
  return from === null ? 0 : now - from;
};

/** One member of a bundle — a category of the account stream, say. */
const ChildRow = ({ child }: { child: TaskChild }) => {
  const { t } = useTranslation();
  const settled = child.state === 'done' || child.state === 'failed';
  const fraction =
    child.state === 'done' || child.state === 'failed'
      ? 1
      : child.total !== null && child.total > 0
        ? Math.min(1, Math.max(0, child.done / child.total))
        : null;
  return (
    <li className={`${s.child} ${child.state === 'waiting' ? s.childWaiting : ''}`}>
      <span className={s.childIcon}>
        {child.logo ? (
          <img className={s.childLogo} src={child.logo} alt="" aria-hidden />
        ) : (
          <Boxes size={12} />
        )}
      </span>
      <span className={s.childText}>
        <span className={s.childTitle}>{t(child.title.key, child.title.params ?? {})}</span>
        {child.detail && (
          <span className={s.childDetail}>{t(child.detail.key, child.detail.params ?? {})}</span>
        )}
      </span>
      {settled ? (
        <span
          className={`${s.childMark} ${child.state === 'failed' ? s.childMarkFail : s.childMarkOk}`}
        >
          {child.state === 'failed' ? <AlertTriangle size={12} /> : <Check size={12} />}
        </span>
      ) : (
        <span className={s.childBar} aria-hidden>
          <span className={s.childBarFill} style={{ width: `${(fraction ?? 0) * 100}%` }} />
        </span>
      )}
    </li>
  );
};

const TaskRow = ({ task }: { task: Task }) => {
  const { t } = useTranslation();
  const Icon = ICON[task.kind];
  const fraction = taskFraction(task);
  return (
    <li className={s.row}>
      <div className={s.rowMain}>
        <span className={s.rowIcon}>
          {/* A logo when the task said what it is about, the kind's glyph when it did not. */}
          {task.logo ? (
            <img className={s.rowLogo} src={task.logo} alt="" aria-hidden />
          ) : (
            <Icon size={16} />
          )}
        </span>
        <span className={s.rowText}>
          <span className={s.rowTitle}>{t(task.title.key, task.title.params ?? {})}</span>
          {task.detail && (
            <span className={s.rowDetail}>{t(task.detail.key, task.detail.params ?? {})}</span>
          )}
          {/* biome-ignore lint/a11y/useFocusableInteractive: a progressbar is a live region, not a widget — ARIA gives it no keyboard interaction, and a read-only bar in the tab order is a stop that does nothing. The popover around it is aria-live, so the value is announced without anyone having to reach it. */}
          <span
            className={`${s.bar} ${fraction === null ? s.barIndeterminate : ''}`}
            role="progressbar"
            aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className={s.barFill}
              style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
            />
          </span>
        </span>
        {task.cancel && (
          <button
            type="button"
            className={s.rowCancel}
            onClick={task.cancel}
            aria-label={t('tasks.cancel')}
            title={t('tasks.cancel')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {task.children && task.children.length > 0 && (
        <ul className={s.children}>
          {task.children.map((child) => (
            <ChildRow key={child.id} child={child} />
          ))}
        </ul>
      )}
    </li>
  );
};

export const TaskDock = () => {
  const { t } = useTranslation();
  const map = useTasks((st) => st.tasks);
  const tasks = useMemo(() => orderedTasks(map), [map]);
  const [hovered, setHovered] = useState(false);
  // Click pins the list open, for a pointer that cannot hover and for reading a long list without having to keep the cursor.
  const [pinned, setPinned] = useState(false);
  const open = tasks.length > 0 && (hovered || pinned);
  const ref = useDismiss<HTMLDivElement>(pinned, () => setPinned(false));

  const oldest = tasks.length > 0 ? Math.min(...tasks.map((task) => task.startedAt)) : null;
  const elapsed = useElapsed(oldest);
  const fraction = overallFraction(tasks);

  /** An empty list closes the dock. */
  const idle = tasks.length === 0;
  useEffect(() => {
    if (!idle) return;
    setPinned(false);
    setHovered(false);
  }, [idle]);

  // Nothing running, nothing drawn — including the clock's interval, which `useElapsed` drops on a `null` start.
  if (tasks.length === 0) return null;

  return (
    <div
      className={s.dock}
      ref={ref}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {open && (
        <div className={s.popoverAnchor}>
          <div className={s.popover} role="status" aria-live="polite">
            <div className={s.popoverHead}>{t('tasks.count', { count: tasks.length })}</div>
            <ul className={s.list}>
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          </div>
        </div>
      )}

      <button
        type="button"
        className={s.trigger}
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-expanded={open}
        aria-label={t('tasks.count', { count: tasks.length })}
      >
        <span className={s.progress}>
          <svg className={s.ring} viewBox="0 0 58 58" aria-hidden focusable="false">
            <circle className={s.ringTrack} cx="29" cy="29" r={RADIUS} />
            <circle
              className={`${s.ringFill} ${fraction === null ? s.ringSpin : ''}`}
              cx="29"
              cy="29"
              r={RADIUS}
              strokeDasharray={
                // An indeterminate ring is a short arc that goes round on its own; a measured one is filled to where the work actually is.
                fraction === null
                  ? `${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE}`
                  : `${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`
              }
            />
          </svg>
          {fraction !== null && (
            <span className={s.percent}>
              {t('tasks.percent', { percent: Math.round(fraction * 100) })}
            </span>
          )}
        </span>
        <span className={s.text}>
          <span className={s.title}>{t('tasks.count', { count: tasks.length })}</span>
          <span className={s.description}>{formatElapsed(elapsed)}</span>
        </span>
      </button>
    </div>
  );
};

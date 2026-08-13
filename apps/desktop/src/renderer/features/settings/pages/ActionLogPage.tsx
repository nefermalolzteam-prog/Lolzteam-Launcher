import { ACTION_STATUSES, type ActionEntry } from '@shared-types';
import {
  ChevronDown,
  Download,
  Filter,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { Fragment, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDismiss } from '~/lib/useDismiss';
import { useActionLog } from '~/stores/actionLog';
import { Menu } from '~/widgets/Menu/Menu';
import { MenuItem } from '~/widgets/Menu/MenuItem';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { ConfirmDialog } from '../ui/SettingsControls';
import s from './ActionLogPage.module.scss';
import {
  EMPTY_FILTER,
  type LogFilter,
  type LogRun,
  type StatusFilter,
  collapseRuns,
  countByGroup,
  countByStatus,
  filterEntries,
  formatClock,
  formatDuration,
  groupsOf,
  sectionsOf,
} from './actionLogRules';

/** `2025-08-07` → «7 августа», or «Сегодня» / «Вчера» when it is one of those. */
const useDayLabel = () => {
  const { t, i18n } = useTranslation();
  return (day: string): string => {
    const today = new Date();
    const [y, m, d] = day.split('-').map(Number);
    if (y === undefined || m === undefined || d === undefined) return day;
    const date = new Date(y, m - 1, d);
    const diff = Math.round(
      (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
        date.getTime()) /
        86_400_000,
    );
    if (diff === 0) return t('settings.actionLog.today');
    if (diff === 1) return t('settings.actionLog.yesterday');
    return new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'long',
      ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
  };
};

/** Одна запись журнала. */
const Row = ({
  entry,
  nested,
  badge,
}: {
  entry: ActionEntry;
  nested?: boolean;
  badge?: ReactNode;
}) => {
  const { t } = useTranslation();
  // An id the running version has never heard of still has to render: the journal outlives the release that wrote it.
  const label = t(`settings.actionLog.actions.${entry.action}`, { defaultValue: entry.action });
  const failed = entry.status === 'fail';
  const detailBelow = failed && entry.detail;

  return (
    <li className={`${s.row} ${nested ? s.rowNested : ''}`}>
      <span className={s.rowTime}>{formatClock(entry.at)}</span>
      <Tooltip label={t(`settings.actionLog.status.${entry.status}`)}>
        <span className={`${s.dot} ${s[`dot_${entry.status}`]}`} />
      </Tooltip>
      <span className={s.rowBody}>
        <span className={`${s.rowTitle} ${failed ? s.rowTitleFail : ''}`}>{label}</span>
        {entry.target && <span className={s.rowMeta}>{entry.target}</span>}
        {entry.detail && !detailBelow && <span className={s.rowMeta}>{entry.detail}</span>}
        {badge}
      </span>
      <span className={s.rowDuration}>{formatDuration(entry.durationMs)}</span>
      {detailBelow && <span className={s.rowReason}>{entry.detail}</span>}
    </li>
  );
};

/** Пачка одинаковых записей подряд. */
const RunRows = ({ run }: { run: LogRun }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const total = run.rest.length + 1;

  if (run.rest.length === 0) return <Row entry={run.head} />;

  return (
    <>
      <Row
        entry={run.head}
        badge={
          <Tooltip
            label={
              open
                ? t('settings.actionLog.collapse')
                : t('settings.actionLog.repeats', { count: total })
            }
          >
            <button
              type="button"
              className={s.repeat}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              ×{total}
            </button>
          </Tooltip>
        }
      />
      {open && run.rest.map((entry) => <Row key={entry.id} entry={entry} nested />)}
    </>
  );
};

export const ActionLogPage = () => {
  const { t } = useTranslation();
  const entries = useActionLog((p) => p.entries);
  const loading = useActionLog((p) => p.loading);
  const loaded = useActionLog((p) => p.loaded);
  const load = useActionLog((p) => p.load);
  const clear = useActionLog((p) => p.clear);

  const [filter, setFilter] = useState<LogFilter>(EMPTY_FILTER);
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const groupRef = useDismiss<HTMLDivElement>(groupOpen, () => setGroupOpen(false));
  const moreRef = useDismiss<HTMLDivElement>(moreOpen, () => setMoreOpen(false));

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countByStatus(entries), [entries]);
  const groups = useMemo(() => groupsOf(entries), [entries]);
  const groupCounts = useMemo(() => countByGroup(entries), [entries]);
  const sections = useMemo(() => sectionsOf(filterEntries(entries, filter)), [entries, filter]);
  const shown = useMemo(() => sections.reduce((n, sec) => n + sec.entries.length, 0), [sections]);
  const dayLabel = useDayLabel();

  const groupLabel =
    filter.group === 'all'
      ? t('settings.actionLog.groups.all')
      : t(`settings.actionLog.groups.${filter.group}`, { defaultValue: filter.group });

  const setStatus = (status: StatusFilter) => setFilter((f) => ({ ...f, status }));
  const setGroup = (group: string) => {
    setFilter((f) => ({ ...f, group }));
    setGroupOpen(false);
  };

  const doExport = async () => {
    setExporting(true);
    setExported(null);
    const result = await window.launcher.actionLog.export();
    setExporting(false);
    if (result.ok && result.path) setExported(result.path);
  };

  const busy = loading || exporting;

  return (
    <>
      <div className={s.card}>
        <div className={s.toolbar}>
          <div className={s.search}>
            <Search size={16} className={s.searchIcon} />
            <input
              type="search"
              className={s.searchInput}
              value={filter.query}
              placeholder={t('settings.actionLog.search')}
              onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            />
          </div>

          {/* Ниже — отборы и действия, отдельным рядом. */}
          <div className={s.filters}>
            {/* Состояние — переключатель из четырёх делений, а не четыре фишки в ряд: выбрано всегда ровно одно. */}
            <div className={s.seg} role="group" aria-label={t('settings.actionLog.statusLabel')}>
              <button
                type="button"
                className={`${s.segBtn} ${filter.status === 'all' ? s.segBtnOn : ''}`}
                aria-pressed={filter.status === 'all'}
                onClick={() => setStatus('all')}
              >
                {t('settings.actionLog.status.all')}
                <span className={s.segCount}>{counts.all}</span>
              </button>
              {ACTION_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`${s.segBtn} ${filter.status === status ? s.segBtnOn : ''}`}
                  aria-pressed={filter.status === status}
                  onClick={() => setStatus(status)}
                >
                  {t(`settings.actionLog.status.${status}`)}
                  <span className={s.segCount}>{counts[status]}</span>
                </button>
              ))}
            </div>

            {/* Разделов полтора десятка, и раньше они лежали вторым рядом фишек — ряд шире списка. */}
            {groups.length > 1 && (
              <div className={s.picker} ref={groupRef}>
                <button
                  type="button"
                  className={s.pickerTrigger}
                  aria-haspopup="menu"
                  aria-expanded={groupOpen}
                  onClick={() => setGroupOpen((v) => !v)}
                >
                  <Filter size={15} className={s.pickerIcon} />
                  <span className={s.pickerValue}>{groupLabel}</span>
                  <ChevronDown
                    size={15}
                    className={`${s.chevron} ${groupOpen ? s.chevronOpen : ''}`}
                  />
                </button>
                <Menu
                  open={groupOpen}
                  onClose={() => setGroupOpen(false)}
                  label={t('settings.actionLog.groupsLabel')}
                >
                  <MenuItem checked={filter.group === 'all'} onSelect={() => setGroup('all')}>
                    <span className={s.optionRow}>
                      <span className={s.optionName}>{t('settings.actionLog.groups.all')}</span>
                      <span className={s.optionCount}>{entries.length}</span>
                    </span>
                  </MenuItem>
                  {groups.map((group) => (
                    <MenuItem
                      key={group}
                      checked={filter.group === group}
                      onSelect={() => setGroup(group)}
                    >
                      <span className={s.optionRow}>
                        <span className={s.optionName}>
                          {t(`settings.actionLog.groups.${group}`, { defaultValue: group })}
                        </span>
                        <span className={s.optionCount}>{groupCounts[group] ?? 0}</span>
                      </span>
                    </MenuItem>
                  ))}
                </Menu>
              </div>
            )}

            {/* Обновить, сохранить, очистить — три действия, которые делают раз в месяц. */}
            <div className={s.moreWrap} ref={moreRef}>
              <Tooltip label={t('settings.actionLog.more')}>
                <button
                  type="button"
                  className={s.iconBtn}
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  aria-label={t('settings.actionLog.more')}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  {busy ? <Loader2 size={17} className={s.spin} /> : <MoreHorizontal size={17} />}
                </button>
              </Tooltip>
              <Menu
                open={moreOpen}
                onClose={() => setMoreOpen(false)}
                label={t('settings.actionLog.more')}
              >
                <MenuItem
                  icon={<RefreshCw size={16} />}
                  disabled={loading}
                  onSelect={() => void load(true)}
                >
                  {t('settings.actionLog.refresh')}
                </MenuItem>
                <MenuItem
                  icon={<Download size={16} />}
                  disabled={exporting || entries.length === 0}
                  onSelect={() => void doExport()}
                >
                  {t('settings.actionLog.export')}
                </MenuItem>
                <MenuItem
                  danger
                  icon={<Trash2 size={16} />}
                  disabled={entries.length === 0}
                  onSelect={() => setConfirming(true)}
                >
                  {t('settings.actionLog.clear')}
                </MenuItem>
              </Menu>
            </div>
          </div>
        </div>

        {exported && <p className={s.exported}>{t('settings.actionLog.exported', { exported })}</p>}

        {shown === 0 ? (
          <p className={s.empty}>
            {!loaded && loading
              ? t('settings.actionLog.loading')
              : entries.length === 0
                ? t('settings.actionLog.empty')
                : t('settings.actionLog.emptyFiltered')}
          </p>
        ) : (
          sections.map((section) => {
            const failed = countByStatus(section.entries).fail;
            return (
              <Fragment key={section.day}>
                {/* Полоса дня — не заголовок карточки, а разрыв в ленте: список идёт сплошняком. */}
                <div className={s.day}>
                  <span>{dayLabel(section.day)}</span>
                  <span className={s.dayCount}>
                    {t('settings.actionLog.count', { count: section.entries.length })}
                    {failed > 0 && ` · ${t('settings.actionLog.errors', { count: failed })}`}
                  </span>
                </div>
                <ul className={s.list}>
                  {collapseRuns(section.entries).map((run) => (
                    <RunRows key={run.head.id} run={run} />
                  ))}
                </ul>
              </Fragment>
            );
          })
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={t('settings.actionLog.clear')}
          body={t('settings.actionLog.clearConfirm')}
          cancelLabel={t('settings.actionLog.cancel')}
          onClose={() => setConfirming(false)}
          actions={[
            {
              label: t('settings.actionLog.clear'),
              variant: 'danger',
              onClick: () => {
                setConfirming(false);
                void clear();
              },
            },
          ]}
        />
      )}
    </>
  );
};

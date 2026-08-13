import type {
  LauncherSettings,
  ProxyEntry,
  ProxyFolder,
  ProxyTestResult,
  ServiceId,
} from '@shared-types';
import { PROXY_CAPABLE_SERVICES, serviceLabel } from '@shared-types';
import {
  Check,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  groupProxiesByFolder,
  inFolder,
  parseProxyLine,
  proxyDetail,
  proxyKey,
  proxyName,
} from '~/lib/proxy';
import { serviceLogo } from '~/lib/serviceLogos';
import { formatAgo } from '~/lib/time';
import { useClockTick } from '~/lib/useClockTick';
import { useDismiss } from '~/lib/useDismiss';
import { recordAction } from '~/stores/actionLog';
import { proxyChecksStopped, useProxyChecks } from '~/stores/proxyChecks';
import { patchSettings, useSettings } from '~/stores/settings';
import { Button } from '~/widgets/Button/Button';
import { Menu } from '~/widgets/Menu/Menu';
import { MenuItem } from '~/widgets/Menu/MenuItem';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalField,
  ModalHint,
  ModalInput,
  ModalSelect,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { RefreshIcon } from '~/widgets/icons/Icons';
import {
  type ChoiceOption,
  SettingChoice,
  SettingGroup,
  SettingRow,
  SettingToggle,
} from '../ui/SettingsControls';
import { PencilIcon, TrashIcon } from '../ui/SettingsIcons';
import s from './ProxyPage.module.scss';

const ALL = 'all';
const NONE = 'none';
type Filter = typeof ALL | typeof NONE | string;

/* Идентификаторы форм: кнопка сохранения стоит в футере каркаса — то есть вне формы. */
const FOLDER_FORM = 'proxy-folder-form';
const PROXY_FORM = 'proxy-edit-form';

const withoutFolder = (p: ProxyEntry): ProxyEntry => {
  const { folderId: _drop, ...rest } = p;
  return rest;
};

export const ProxyPage = () => {
  const { t, i18n } = useTranslation();
  useClockTick();
  const settings = useSettings((st) => st.settings);
  const [bulk, setBulk] = useState('');
  const [checkOnAdd, setCheckOnAdd] = useState(true);
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyEntry | null>(null);
  const bulkCheck = useProxyChecks((st) => st.run);
  const [liveResults, setLiveResults] = useState<Record<string, ProxyTestResult>>({});
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Форма добавления свёрнута по умолчанию. */
  const [addOpen, setAddOpen] = useState(false);
  const [forumLoading, setForumLoading] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(ALL);
  const [folderForm, setFolderForm] = useState<{ folder: ProxyFolder | null } | null>(null);
  const [folderDelete, setFolderDelete] = useState<ProxyFolder | null>(null);
  const folderMenuRef = useDismiss<HTMLDivElement>(folderMenuOpen, () => setFolderMenuOpen(false));
  const moreRef = useDismiss<HTMLDivElement>(moreOpen, () => setMoreOpen(false));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `bulk` — содержимое поля, `addOpen` — момент, когда поле вообще появляется в дереве; мерить высоту надо и там, и там, а само тело эффекта не читает ни то, ни другое.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [bulk, addOpen]);

  const lineCount = Math.max(3, bulk.split('\n').length);

  const proxies = settings?.proxies ?? [];
  const folders = settings?.proxyFolders ?? [];
  const proxyEnabled = settings?.proxyEnabled ?? false;
  const proxyServices = settings?.proxyServices ?? [];
  const appProxyId = settings?.appProxyId ?? null;

  const proxiesRef = useRef<ProxyEntry[]>(proxies);
  proxiesRef.current = proxies;

  const activeFolder = folders.find((f) => f.id === filter) ?? null;
  const visible =
    filter === ALL
      ? proxies
      : filter === NONE
        ? inFolder(proxies, folders, null)
        : inFolder(proxies, folders, filter);
  const visibleIds = new Set(visible.map((p) => p.id));
  const noneCount = inFolder(proxies, folders, null).length;

  useEffect(() => {
    if (settings && appProxyId && !proxies.some((p) => p.id === appProxyId)) {
      void persist({ appProxyId: null });
    }
  }, [settings, appProxyId, proxies]);

  useEffect(() => {
    if (filter !== ALL && filter !== NONE && !folders.some((f) => f.id === filter)) setFilter(ALL);
  }, [filter, folders]);

  const persist = (patch: Partial<LauncherSettings>) => patchSettings(patch);

  const patchProxyTest = async (id: string, test: ProxyTestResult) => {
    const next = proxiesRef.current.map((p) => (p.id === id ? { ...p, test } : p));
    proxiesRef.current = next;
    await persist({ proxies: next });
  };

  const toggleEnabled = () => void persist({ proxyEnabled: !proxyEnabled });

  const setAppProxy = (id: string | null) => void persist({ appProxyId: id });

  const toggleService = (id: ServiceId) => {
    const next = proxyServices.includes(id)
      ? proxyServices.filter((x) => x !== id)
      : [...proxyServices, id];
    void persist({ proxyServices: next });
  };

  const saveFolder = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !folderForm) return;
    if (folderForm.folder) {
      const id = folderForm.folder.id;
      void persist({
        proxyFolders: folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
      });
    } else {
      const id = crypto.randomUUID();
      void persist({ proxyFolders: [...folders, { id, name: trimmed }] });
      setFilter(id);
    }
    setFolderForm(null);
  };

  const deleteFolder = (withProxies: boolean) => {
    if (!folderDelete) return;
    const id = folderDelete.id;
    const nextProxies = withProxies
      ? proxiesRef.current.filter((p) => p.folderId !== id)
      : proxiesRef.current.map((p) => (p.folderId === id ? withoutFolder(p) : p));
    proxiesRef.current = nextProxies;
    void persist({ proxyFolders: folders.filter((f) => f.id !== id), proxies: nextProxies });
    setFolderDelete(null);
    setFilter(ALL);
  };

  const mergeProxies = (
    incoming: Omit<ProxyEntry, 'id'>[],
  ): { added: ProxyEntry[]; moved: number } => {
    const target = activeFolder?.id;
    const existing = new Map(proxiesRef.current.map((p) => [proxyKey(p), p] as const));
    const seen = new Set<string>();
    const added: ProxyEntry[] = [];
    const movedIds = new Set<string>();

    for (const p of incoming) {
      const key = proxyKey(p);
      if (seen.has(key)) continue;
      seen.add(key);
      const dup = existing.get(key);
      if (dup) {
        if (target && dup.folderId !== target) movedIds.add(dup.id);
        continue;
      }
      added.push({ ...p, id: crypto.randomUUID(), ...(target ? { folderId: target } : {}) });
    }

    if (added.length === 0 && movedIds.size === 0) return { added, moved: 0 };
    const next = [
      ...proxiesRef.current.map((p) => (movedIds.has(p.id) ? { ...p, folderId: target } : p)),
      ...added,
    ];
    proxiesRef.current = next;
    void persist({ proxies: next });
    return { added, moved: movedIds.size };
  };

  const addProxies = async () => {
    const parsed = bulk
      .split('\n')
      .map(parseProxyLine)
      .filter((p): p is Omit<ProxyEntry, 'id'> => p !== null);
    if (parsed.length === 0) return;
    const { added, moved } = mergeProxies(parsed);
    setBulk('');
    setAddMsg(moved > 0 ? t('settings.proxy.bulkMoved', { count: moved }) : null);
    if (checkOnAdd) await runChecks(added);
  };

  const loadFromForum = async () => {
    if (forumLoading) return;
    setForumLoading(true);
    setAddMsg(null);
    try {
      const res = await window.launcher.proxy.fetchMarket();
      if (!res.ok) {
        setAddMsg(t('settings.proxy.forumFailed'));
        return;
      }
      const { added, moved } = mergeProxies(res.proxies ?? []);
      setAddMsg(
        moved > 0
          ? `${t('settings.proxy.forumAdded', { count: added.length })} · ${t('settings.proxy.bulkMoved', { count: moved })}`
          : t('settings.proxy.forumAdded', { count: added.length }),
      );
      if (checkOnAdd && added.length > 0) await runChecks(added);
    } catch {
      setAddMsg(t('settings.proxy.forumFailed'));
    } finally {
      setForumLoading(false);
    }
  };

  const removeProxy = (id: string) => {
    void persist({ proxies: proxiesRef.current.filter((p) => p.id !== id) });
  };

  const deleteAll = () => {
    void persist({ proxies: proxiesRef.current.filter((p) => !visibleIds.has(p.id)) });
    setDeleteAllOpen(false);
  };

  const invalidCount = visible.filter((p) => p.test?.ok === false).length;

  const deleteInvalid = () => {
    void persist({
      proxies: proxiesRef.current.filter((p) => !(visibleIds.has(p.id) && p.test?.ok === false)),
    });
  };

  const runTest = async (entry: ProxyEntry): Promise<ProxyTestResult> => {
    try {
      const res = await window.launcher.proxy.test({
        host: entry.host,
        port: entry.port,
        username: entry.username,
        password: entry.password,
        protocol: entry.protocol,
      });
      return {
        ok: res.ok,
        checkedAt: Date.now(),
        ...(res.ok ? { ms: res.ms, ip: res.ip } : { message: res.message }),
      };
    } catch (err) {
      return {
        ok: false,
        checkedAt: Date.now(),
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const runChecks = async (list: ProxyEntry[]): Promise<void> => {
    if (list.length === 0 || useProxyChecks.getState().run !== null) return;
    const runId = useProxyChecks.getState().begin(list.length);
    setLiveResults({});
    setTesting(new Set(list.map((p) => p.id)));
    const startedAt = Date.now();

    const results: Record<string, ProxyTestResult> = {};
    let idx = 0;
    const worker = async () => {
      while (idx < list.length) {
        if (proxyChecksStopped(runId)) return;
        const entry = list[idx++];
        if (!entry) break;
        const test = await runTest(entry);
        results[entry.id] = test;
        setLiveResults((prev) => ({ ...prev, [entry.id]: test }));
        setTesting((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
        useProxyChecks.getState().advance(runId, test.ok);
      }
    };
    const CONCURRENCY = 6;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

    const next = proxiesRef.current.map((p) => (results[p.id] ? { ...p, test: results[p.id] } : p));
    proxiesRef.current = next;
    await persist({ proxies: next });
    useProxyChecks.getState().end(runId);

    const checked = Object.values(results);
    const failed = checked.filter((test) => !test.ok).length;
    recordAction({
      action: 'proxy.check',
      status: checked.length < list.length ? 'cancelled' : failed > 0 ? 'fail' : 'ok',
      durationMs: Date.now() - startedAt,
      detail: `${checked.length - failed}/${list.length} ok`,
    });

    setTesting(new Set());
    setLiveResults({});
  };

  const checkAll = () => runChecks(visible);

  const saveEdit = (next: ProxyEntry) => {
    const prev = proxiesRef.current.find((p) => p.id === next.id);
    const keepTest = prev?.test && proxyKey(prev) === proxyKey(next);
    const saved: ProxyEntry = keepTest ? { ...next, test: prev.test } : withoutTest(next);
    void persist({
      proxies: proxiesRef.current.map((p) => (p.id === next.id ? saved : p)),
    });
    setEditing(null);
  };

  const testProxy = async (entry: ProxyEntry) => {
    setTesting((prev) => new Set(prev).add(entry.id));
    try {
      await patchProxyTest(entry.id, await runTest(entry));
    } finally {
      setTesting((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  /** Список для выбора прокси приложения. */
  const appOptions: ChoiceOption<string>[] = [
    { value: '', label: t('settings.proxy.appNone') },
    ...groupProxiesByFolder(proxies, folders).flatMap((group) =>
      group.items.map((p) => {
        const hint = [proxyDetail(p), group.folder?.name].filter(Boolean).join(' · ');
        return { value: p.id, label: proxyName(p), ...(hint ? { hint } : {}) };
      }),
    ),
  ];

  const filterLabel =
    filter === ALL
      ? t('settings.proxy.folderAll')
      : filter === NONE
        ? t('settings.proxy.folderNone')
        : (activeFolder?.name ?? t('settings.proxy.folderAll'));

  return (
    <>
      <SettingGroup label={t('settings.proxy.sectionConnection')}>
        <SettingChoice
          title={t('settings.proxy.appLabel')}
          description={t('settings.proxy.appHint')}
          modalTitle={t('settings.proxy.appLabel')}
          options={appOptions}
          value={appProxyId ?? ''}
          onChange={(v) => setAppProxy(v === '' ? null : v)}
        />

        <SettingToggle
          title={t('settings.proxy.toggleLabel')}
          description={t('settings.proxy.toggleHint')}
          checked={proxyEnabled}
          onChange={toggleEnabled}
        />

        {proxyEnabled && (
          <SettingRow
            stack
            title={t('settings.proxy.servicesLabel')}
            description={t('settings.proxy.servicesHint')}
          >
            <div className={s.chips}>
              {PROXY_CAPABLE_SERVICES.map((id) => {
                const on = proxyServices.includes(id);
                const logo = serviceLogo(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className={`${s.chip} ${on ? s.chipOn : ''}`}
                    onClick={() => toggleService(id)}
                  >
                    {/* Знак сервиса вместо галочки: галочка появлялась только у включённых и раздвигала фишку на каждом клике. */}
                    {logo ? (
                      <img className={s.chipLogo} src={logo} alt="" width={16} height={16} />
                    ) : (
                      on && <Check size={14} />
                    )}
                    <span>{serviceLabel(id)}</span>
                  </button>
                );
              })}
            </div>
          </SettingRow>
        )}
      </SettingGroup>

      <section className={s.listSection}>
        <h3 className={s.sectionLabel}>{t('settings.proxy.sectionList')}</h3>

        <div className={s.listCard}>
          <div className={s.toolbar}>
            <div className={s.toolbarInfo}>
              <span className={s.listCount}>
                {bulkCheck
                  ? t('settings.proxy.checkAllProgress', {
                      done: bulkCheck.done,
                      total: bulkCheck.total,
                    })
                  : t('settings.proxy.listCount', { count: visible.length })}
              </span>
              {invalidCount > 0 && (
                <span className={`${s.pill} ${s.pillBad}`}>
                  {t('settings.proxy.invalidCount', { count: invalidCount })}
                </span>
              )}
            </div>

            <div className={s.toolbarActions}>
              {/* Папки были рядом фишек над списком и занимали строку целиком, а выбрана из них всегда ровно одна. */}
              <div className={s.picker} ref={folderMenuRef}>
                <button
                  type="button"
                  className={s.pickerTrigger}
                  aria-haspopup="menu"
                  aria-expanded={folderMenuOpen}
                  onClick={() => setFolderMenuOpen((v) => !v)}
                >
                  <Folder size={14} className={s.pickerIcon} />
                  <span className={s.pickerValue}>{filterLabel}</span>
                  <ChevronDown
                    size={14}
                    className={`${s.chevron} ${folderMenuOpen ? s.chevronOpen : ''}`}
                  />
                </button>
                <Menu
                  open={folderMenuOpen}
                  onClose={() => setFolderMenuOpen(false)}
                  label={t('settings.proxy.foldersLabel')}
                >
                  <MenuItem checked={filter === ALL} onSelect={() => setFilter(ALL)}>
                    <span className={s.optionRow}>
                      <span>{t('settings.proxy.folderAll')}</span>
                      <span className={s.optionCount}>{proxies.length}</span>
                    </span>
                  </MenuItem>
                  {folders.map((f) => (
                    <MenuItem key={f.id} checked={filter === f.id} onSelect={() => setFilter(f.id)}>
                      <span className={s.optionRow}>
                        <span>{f.name}</span>
                        <span className={s.optionCount}>
                          {inFolder(proxies, folders, f.id).length}
                        </span>
                      </span>
                    </MenuItem>
                  ))}
                  {(noneCount > 0 || folders.length > 0) && (
                    <MenuItem checked={filter === NONE} onSelect={() => setFilter(NONE)}>
                      <span className={s.optionRow}>
                        <span>{t('settings.proxy.folderNone')}</span>
                        <span className={s.optionCount}>{noneCount}</span>
                      </span>
                    </MenuItem>
                  )}
                </Menu>
              </div>

              <Button
                size="sm"
                variant="neutral"
                icon={ShieldCheck}
                busy={bulkCheck !== null}
                disabled={visible.length === 0}
                onClick={() => void checkAll()}
              >
                {t('settings.proxy.checkAll')}
              </Button>

              <Button
                size="sm"
                variant={addOpen ? 'neutral' : 'accent'}
                icon={addOpen ? ChevronUp : Plus}
                aria-expanded={addOpen}
                onClick={() => setAddOpen((v) => !v)}
              >
                {addOpen ? t('settings.proxy.addCollapse') : t('settings.proxy.addShort')}
              </Button>

              {/* Всё, что делают раз в месяц, — за одной кнопкой: создать папку, переименовать её, удалить невалид, очистить список. */}
              <div className={s.moreWrap} ref={moreRef}>
                <Tooltip label={t('settings.proxy.moreLabel')}>
                  <button
                    type="button"
                    className={s.iconBtn}
                    aria-haspopup="menu"
                    aria-expanded={moreOpen}
                    aria-label={t('settings.proxy.moreLabel')}
                    onClick={() => setMoreOpen((v) => !v)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </Tooltip>
                <Menu
                  open={moreOpen}
                  onClose={() => setMoreOpen(false)}
                  label={t('settings.proxy.moreLabel')}
                >
                  <MenuItem
                    icon={<FolderPlus size={16} />}
                    onSelect={() => setFolderForm({ folder: null })}
                  >
                    {t('settings.proxy.folderNew')}
                  </MenuItem>
                  {activeFolder && (
                    <MenuItem
                      icon={<Pencil size={16} />}
                      onSelect={() => setFolderForm({ folder: activeFolder })}
                    >
                      {t('settings.proxy.folderRenameLabel')}
                    </MenuItem>
                  )}
                  {activeFolder && (
                    <MenuItem
                      danger
                      icon={<Trash2 size={16} />}
                      onSelect={() => setFolderDelete(activeFolder)}
                    >
                      {t('settings.proxy.folderDeleteLabel')}
                    </MenuItem>
                  )}
                  {invalidCount > 0 && (
                    <MenuItem
                      danger
                      disabled={bulkCheck !== null}
                      icon={<Trash2 size={16} />}
                      onSelect={deleteInvalid}
                    >
                      {t('settings.proxy.deleteInvalid', { count: invalidCount })}
                    </MenuItem>
                  )}
                  {visible.length > 0 && (
                    <MenuItem
                      danger
                      disabled={bulkCheck !== null}
                      icon={<Trash2 size={16} />}
                      onSelect={() => setDeleteAllOpen(true)}
                    >
                      {filter === ALL
                        ? t('settings.proxy.deleteAll')
                        : t('settings.proxy.deleteAllVisible')}
                    </MenuItem>
                  )}
                </Menu>
              </div>
            </div>
          </div>

          {addOpen && (
            <div className={s.addPanel}>
              <div className={s.editorScroll}>
                <div className={s.editor}>
                  <div className={s.gutter} aria-hidden>
                    {Array.from({ length: lineCount }, (_, i) => (
                      <span key={i} className={s.lineNo}>
                        {i + 1}
                      </span>
                    ))}
                  </div>
                  <textarea
                    ref={textareaRef}
                    className={s.textarea}
                    value={bulk}
                    onChange={(e) => setBulk(e.target.value)}
                    placeholder={t('settings.proxy.bulkPlaceholder')}
                    rows={3}
                    spellCheck={false}
                    wrap="off"
                  />
                </div>
              </div>
              {activeFolder && (
                <p className={s.addTarget}>
                  {t('settings.proxy.addTargetHint', { name: activeFolder.name })}
                </p>
              )}
              <div className={s.addRow}>
                <Button
                  size="sm"
                  variant="accent"
                  icon={Plus}
                  onClick={() => void addProxies()}
                  disabled={bulk.trim() === '' || bulkCheck !== null}
                >
                  {t('settings.proxy.addLabel')}
                </Button>
                <Button
                  size="sm"
                  variant="neutral"
                  icon={CloudDownload}
                  busy={forumLoading}
                  disabled={bulkCheck !== null}
                  onClick={() => void loadFromForum()}
                >
                  {t('settings.proxy.loadFromForum')}
                </Button>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checkOnAdd}
                  className={`${s.chip} ${s.chipTrailing} ${checkOnAdd ? s.chipOn : ''}`}
                  onClick={() => setCheckOnAdd((v) => !v)}
                >
                  <Check size={14} className={s.chipCheck} />
                  <span>{t('settings.proxy.checkOnAdd')}</span>
                </button>
              </div>
              {addMsg && <p className={s.forumMsg}>{addMsg}</p>}
            </div>
          )}

          {visible.length === 0 ? (
            <p className={s.empty}>
              {activeFolder ? t('settings.proxy.folderEmpty') : t('settings.proxy.listEmpty')}
            </p>
          ) : (
            <ul className={s.list}>
              {visible.map((entry) => {
                const isTesting = testing.has(entry.id);
                const res = liveResults[entry.id] ?? entry.test;
                const detail = proxyDetail(entry);
                const folder = filter === ALL ? folders.find((f) => f.id === entry.folderId) : null;
                // Логин и папка — обе приписки к адресу, и раньше одна шла второй строкой, а вторая ярлыком справа от названия.
                const sub = [detail, folder?.name].filter(Boolean).join(' · ');
                return (
                  <li key={entry.id} className={s.row}>
                    <div className={s.rowInfo}>
                      <span className={s.rowHost}>{proxyName(entry)}</span>
                      {sub && <span className={s.rowSub}>{sub}</span>}
                    </div>

                    <div className={s.rowStatus}>
                      {isTesting ? (
                        <span className={s.rowSub}>{t('settings.proxy.testing')}</span>
                      ) : res ? (
                        <>
                          {/* Когда проверяли — в подсказке, а не в строке: это уточнение к «валиду». */}
                          <Tooltip label={formatAgo(res.checkedAt, i18n.language)}>
                            <span className={`${s.pill} ${res.ok ? s.pillOk : s.pillBad}`}>
                              {res.ok
                                ? t('settings.proxy.statusValid')
                                : t('settings.proxy.statusInvalid')}
                            </span>
                          </Tooltip>
                          <span className={s.rowPing}>
                            {res.ok && res.ms !== undefined
                              ? t('settings.proxy.ping', { ms: res.ms })
                              : '—'}
                          </span>
                        </>
                      ) : null}
                    </div>

                    <div className={s.rowActions}>
                      <Tooltip label={t('settings.proxy.testLabel')}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          onClick={() => void testProxy(entry)}
                          disabled={isTesting}
                          aria-label={t('settings.proxy.testLabel')}
                        >
                          {/* Знаки строки — те же рисованные, что у меток (`SettingsIcons`, `RefreshIcon`): страницы настроек держат один набор. */}
                          <RefreshIcon size={15} className={isTesting ? s.spin : undefined} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('settings.proxy.editLabel')}>
                        <button
                          type="button"
                          className={s.iconBtn}
                          onClick={() => setEditing(entry)}
                          aria-label={t('settings.proxy.editLabel')}
                        >
                          <PencilIcon size={15} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('settings.proxy.deleteLabel')}>
                        <button
                          type="button"
                          className={`${s.iconBtn} ${s.iconBtnDanger}`}
                          onClick={() => removeProxy(entry.id)}
                          aria-label={t('settings.proxy.deleteLabel')}
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
      </section>

      {deleteAllOpen && (
        <Modal
          title={t('settings.proxy.deleteAllConfirmTitle')}
          size="sm"
          closable
          onClose={() => setDeleteAllOpen(false)}
          footer={
            <>
              <ModalSpacer />
              <Button variant="ghost" size="sm" onClick={() => setDeleteAllOpen(false)}>
                {t('settings.proxy.cancel')}
              </Button>
              <Button variant="danger" size="sm" onClick={deleteAll}>
                {t('settings.proxy.deleteAll')}
              </Button>
            </>
          }
        >
          <ModalHint>
            {activeFolder
              ? t('settings.proxy.deleteAllFolderBody', {
                  name: activeFolder.name,
                  count: visible.length,
                })
              : t('settings.proxy.deleteAllConfirmBody')}
          </ModalHint>
        </Modal>
      )}

      {folderForm && (
        <FolderModal
          folder={folderForm.folder}
          onCancel={() => setFolderForm(null)}
          onSave={saveFolder}
        />
      )}

      {folderDelete && (
        <Modal
          title={t('settings.proxy.folderDeleteTitle')}
          subtitle={folderDelete.name}
          size="sm"
          closable
          onClose={() => setFolderDelete(null)}
          footer={
            <>
              {/* Опасное — слева, безопасное — справа: «удалить и прокси» и «удалить только папку» отличаются одним словом. */}
              <Button variant="danger" size="sm" onClick={() => deleteFolder(true)}>
                {t('settings.proxy.folderDeleteWithProxies', {
                  count: inFolder(proxies, folders, folderDelete.id).length,
                })}
              </Button>
              <ModalSpacer />
              <Button variant="ghost" size="sm" onClick={() => setFolderDelete(null)}>
                {t('settings.proxy.cancel')}
              </Button>
              <Button variant="accent" size="sm" onClick={() => deleteFolder(false)}>
                {t('settings.proxy.folderDeleteOnly')}
              </Button>
            </>
          }
        >
          <ModalHint>
            {t('settings.proxy.folderDeleteBody', {
              name: folderDelete.name,
              count: inFolder(proxies, folders, folderDelete.id).length,
            })}
          </ModalHint>
        </Modal>
      )}

      {editing && (
        <ProxyEditModal
          entry={editing}
          folders={folders}
          onCancel={() => setEditing(null)}
          onSave={saveEdit}
        />
      )}
    </>
  );
};

const withoutTest = (p: ProxyEntry): ProxyEntry => {
  const { test: _drop, ...rest } = p;
  return rest;
};

/** Папка прокси: одно поле с названием. */
const FolderModal = ({
  folder,
  onCancel,
  onSave,
}: {
  folder: ProxyFolder | null;
  onCancel: () => void;
  onSave: (name: string) => void;
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(folder?.name ?? '');
  const valid = name.trim() !== '';

  return (
    <Modal
      title={folder ? t('settings.proxy.folderRenameTitle') : t('settings.proxy.folderCreateTitle')}
      size="sm"
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('settings.proxy.cancel')}
          </Button>
          {/* `form`, а не `onClick`: кнопка стоит в футере каркаса, вне формы, и связать её с формой можно только по идентификатору. */}
          <Button variant="accent" size="sm" type="submit" form={FOLDER_FORM} disabled={!valid}>
            {t('settings.proxy.save')}
          </Button>
        </>
      }
    >
      <form
        id={FOLDER_FORM}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(name);
        }}
      >
        <ModalField label={t('settings.proxy.folderNameField')}>
          <ModalInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.proxy.folderNamePlaceholder')}
            spellCheck={false}
            autoFocus
          />
        </ModalField>
      </form>
    </Modal>
  );
};

interface ProxyEditModalProps {
  entry: ProxyEntry;
  folders: ProxyFolder[];
  onCancel: () => void;
  onSave: (next: ProxyEntry) => void;
}

const ProxyEditModal = ({ entry, folders, onCancel, onSave }: ProxyEditModalProps) => {
  const { t } = useTranslation();
  const [label, setLabel] = useState(entry.label ?? '');
  const [folderId, setFolderId] = useState(entry.folderId ?? '');
  const [host, setHost] = useState(entry.host);
  const [port, setPort] = useState(String(entry.port));
  const [username, setUsername] = useState(entry.username ?? '');
  const [password, setPassword] = useState(entry.password ?? '');

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535;
  const valid = host.trim() !== '' && portValid;

  const submit = () => {
    if (!valid) return;
    onSave({
      id: entry.id,
      ...(entry.protocol ? { protocol: entry.protocol } : {}),
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(folderId ? { folderId } : {}),
      host: host.trim(),
      port: portNum,
      ...(username.trim() ? { username: username.trim() } : {}),
      ...(password ? { password } : {}),
    });
  };

  return (
    <Modal
      title={t('settings.proxy.editTitle')}
      subtitle={proxyName(entry)}
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('settings.proxy.cancel')}
          </Button>
          <Button variant="accent" size="sm" type="submit" form={PROXY_FORM} disabled={!valid}>
            {t('settings.proxy.save')}
          </Button>
        </>
      }
    >
      <form
        id={PROXY_FORM}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ModalField label={t('settings.proxy.fieldLabel')}>
          <ModalInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`${entry.host}:${entry.port}`}
            spellCheck={false}
            autoFocus
          />
        </ModalField>

        <ModalField label={t('settings.proxy.fieldFolder')}>
          <ModalSelect
            value={folderId}
            onChange={setFolderId}
            items={[
              { value: '', label: t('settings.proxy.folderNone') },
              ...folders.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        </ModalField>

        <ModalField label={t('settings.proxy.fieldHost')}>
          <ModalInput value={host} onChange={(e) => setHost(e.target.value)} spellCheck={false} />
        </ModalField>

        <ModalField label={t('settings.proxy.fieldPort')}>
          <ModalInput
            className={port !== '' && !portValid ? s.inputError : ''}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            inputMode="numeric"
            spellCheck={false}
          />
        </ModalField>

        <ModalField label={t('settings.proxy.fieldUser')}>
          <ModalInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
          />
        </ModalField>

        <ModalField label={t('settings.proxy.fieldPass')}>
          <ModalInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            spellCheck={false}
          />
        </ModalField>
      </form>
    </Modal>
  );
};

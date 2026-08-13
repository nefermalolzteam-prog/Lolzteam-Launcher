import type { LauncherSettings, ProxyEntry, ProxyTestResult } from '@shared-types';
import { Globe, Plus, ShieldOff, Wifi } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  groupProxiesByFolder,
  parseProxyLine,
  proxyDetail,
  proxyKey,
  proxyName,
} from '~/lib/proxy';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalError,
  ModalGroup,
  ModalHint,
  ModalIconButton,
  ModalInput,
  ModalOption,
  ModalSection,
} from '~/widgets/Modal/ModalKit';
import s from './AppProxyModal.module.scss';

interface AppProxyModalProps {
  onClose: () => void;
  onChanged?: () => void;
}

export const AppProxyModal = ({ onClose, onChanged }: AppProxyModalProps) => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [bulk, setBulk] = useState('');
  const [addError, setAddError] = useState(false);
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const proxiesRef = useRef<ProxyEntry[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let alive = true;
    window.launcher.settings.get().then((next) => {
      if (alive) setSettings(next.settings);
    });
    const off = window.launcher.settings.onChanged((next) => setSettings(next.settings));
    return () => {
      mountedRef.current = false;
      alive = false;
      off();
    };
  }, []);

  const proxies = settings?.proxies ?? [];
  const folders = settings?.proxyFolders ?? [];
  const appProxyId = settings?.appProxyId ?? null;
  proxiesRef.current = proxies;

  const persist = async (patch: Partial<LauncherSettings>) => {
    const next = await window.launcher.settings.set(patch);
    setSettings(next.settings);
  };

  const select = async (id: string | null) => {
    await persist({ appProxyId: id });
    onChanged?.();
  };

  const addProxy = async () => {
    const parsed = parseProxyLine(bulk);
    if (!parsed) {
      setAddError(true);
      return;
    }
    setAddError(false);
    const key = proxyKey(parsed);
    const existing = proxiesRef.current.find((p) => proxyKey(p) === key);
    const id = existing?.id ?? crypto.randomUUID();
    const nextProxies = existing ? proxiesRef.current : [...proxiesRef.current, { ...parsed, id }];
    proxiesRef.current = nextProxies;
    await persist({ proxies: nextProxies, appProxyId: id });
    setBulk('');
    onChanged?.();
    void testProxy({ ...parsed, id });
  };

  const testProxy = async (entry: ProxyEntry) => {
    setTesting((prev) => new Set(prev).add(entry.id));
    try {
      const res = await window.launcher.proxy.test({
        host: entry.host,
        port: entry.port,
        username: entry.username,
        password: entry.password,
      });
      const test: ProxyTestResult = res.ok
        ? { ok: true, checkedAt: Date.now(), ms: res.ms, ip: res.ip }
        : { ok: false, checkedAt: Date.now(), message: res.message };
      if (!mountedRef.current) return;
      const current = proxiesRef.current;
      if (!current.some((p) => p.id === entry.id)) return;
      const next = current.map((p) => (p.id === entry.id ? { ...p, test } : p));
      proxiesRef.current = next;
      await persist({ proxies: next });
    } finally {
      setTesting((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const groups = groupProxiesByFolder(proxies, folders);
  // Headers only earn their line when there is more than one group to tell apart.
  const headed = groups.length > 1;

  /** Адрес и последний ответ — одной строкой под названием. */
  const rowHint = (p: ProxyEntry) => {
    const detail = proxyDetail(p);
    const res = p.test;
    return (
      <>
        {detail ? `${detail}${res ? ' · ' : ''}` : ''}
        {res && (
          <span className={res.ok ? s.ok : s.bad}>
            {res.ok ? t('settings.proxy.ping', { ms: res.ms }) : t('settings.proxy.statusInvalid')}
          </span>
        )}
      </>
    );
  };

  const row = (p: ProxyEntry) => (
    <ModalOption
      key={p.id}
      icon={Globe}
      title={proxyName(p)}
      hint={rowHint(p)}
      selected={appProxyId === p.id}
      // Пока адрес проверяют, вертушка встаёт на место галки: строка занята, и выбрать её второй раз, не дождавшись ответа.
      busy={testing.has(p.id)}
      onClick={() => void select(p.id)}
      // Проверка живёт в строке, а не отдельной кнопкой под списком: проверяют всегда конкретный адрес.
      trailing={
        <ModalIconButton
          icon={Wifi}
          label={t('settings.proxy.testLabel')}
          disabled={testing.has(p.id)}
          onClick={() => void testProxy(p)}
        />
      }
    />
  );

  return (
    <Modal title={t('settings.proxy.appLabel')} size="lg" closable onClose={onClose}>
      <ModalHint>{t('settings.proxy.appHint')}</ModalHint>

      <div className={s.addRow}>
        <ModalInput
          value={bulk}
          onChange={(e) => {
            setBulk(e.target.value);
            setAddError(false);
          }}
          placeholder={t('settings.proxy.bulkPlaceholder')}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addProxy();
            }
          }}
        />
        <Button
          variant="neutral"
          size="md"
          iconOnly
          icon={Plus}
          label={t('settings.proxy.addLabel')}
          disabled={bulk.trim() === ''}
          onClick={() => void addProxy()}
        />
      </div>
      {addError && <ModalError>{t('settings.proxy.addInvalid')}</ModalError>}

      <ModalOption
        icon={ShieldOff}
        title={t('settings.proxy.appNone')}
        selected={appProxyId === null}
        onClick={() => void select(null)}
      />

      {groups.map(({ folder, items }) => (
        <ModalSection key={folder?.id ?? 'none'}>
          {headed && (
            <ModalGroup>{folder ? folder.name : t('settings.proxy.folderNone')}</ModalGroup>
          )}
          {items.map(row)}
        </ModalSection>
      ))}
    </Modal>
  );
};

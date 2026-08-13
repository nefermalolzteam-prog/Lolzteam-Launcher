import type { ProxyEntry } from '@shared-types';
import { Globe, ShieldOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { groupProxiesByFolder, proxyDetail, proxyName } from '~/lib/proxy';
import { formatAgo } from '~/lib/time';
import { useClockTick } from '~/lib/useClockTick';
import { useSettings } from '~/stores/settings';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalGroup,
  ModalHint,
  ModalOption,
  ModalSection,
  ModalSpacer,
  ModalStatus,
} from '~/widgets/Modal/ModalKit';
import s from './ProxyChoiceModal.module.scss';

export type ProxyTest = { ip: string; ms: number };

/** The two questions this list can be asked. */
export type ProxyChoiceMode = 'login' | 'pin';

interface ProxyChoiceModalProps {
  proxies: readonly ProxyEntry[];
  /** `proxyId: null` means «без прокси» — in `pin` mode, «снять закрепление». */
  onChoose: (proxyId: string | null, proxyTest: ProxyTest | null) => void;
  onCancel: () => void;
  mode?: ProxyChoiceMode;
  /** `pin` mode: the pin as it stands, ticked in the list. */
  currentId?: string | null;
  /** `login` mode: dial this one immediately instead of asking. */
  autoTestId?: string | null;
}

export const ProxyChoiceModal = ({
  proxies,
  onChoose,
  onCancel,
  mode = 'login',
  currentId = null,
  autoTestId = null,
}: ProxyChoiceModalProps) => {
  const { t, i18n } = useTranslation();
  useClockTick();
  const folders = useSettings((st) => st.settings?.proxyFolders) ?? [];
  const auto =
    mode === 'login' && autoTestId ? proxies.find((p) => p.id === autoTestId) : undefined;
  // Opens straight into the spinner when there is something to dial.
  const [checking, setChecking] = useState(() => auto !== undefined);
  const [failed, setFailed] = useState<{ entry: ProxyEntry; message: string } | null>(null);

  const select = async (entry: ProxyEntry) => {
    if (mode === 'pin') {
      onChoose(entry.id, null);
      return;
    }
    setChecking(true);
    try {
      const res = await window.launcher.proxy.test({
        host: entry.host,
        port: entry.port,
        username: entry.username,
        password: entry.password,
        protocol: entry.protocol,
      });
      setChecking(false);
      if (res.ok) onChoose(entry.id, { ip: res.ip, ms: res.ms });
      else setFailed({ entry, message: res.message });
    } catch (err) {
      setChecking(false);
      setFailed({ entry, message: err instanceof Error ? err.message : String(err) });
    }
  };

  // Once, on mount, and never again: `select` puts the modal into one of its other three states.
  const dialled = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only, guarded by `dialled`
  useEffect(() => {
    if (dialled.current || !auto) return;
    dialled.current = true;
    void select(auto);
  }, []);

  if (checking) {
    return (
      <Modal title={t('inventory.card.proxy.checking')} size="sm" closable={false}>
        <ModalStatus tone="busy" title={t('inventory.card.proxy.checking')} />
      </Modal>
    );
  }

  if (failed) {
    return (
      <Modal
        title={t('inventory.card.proxy.failTitle')}
        subtitle={proxyName(failed.entry)}
        size="md"
        closable
        onClose={() => setFailed(null)}
        footer={
          <>
            <ModalSpacer />
            <Button variant="ghost" size="sm" onClick={() => setFailed(null)}>
              {t('inventory.card.proxy.change')}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t('inventory.card.proxy.exit')}
            </Button>
            <Button variant="accent" size="sm" onClick={() => onChoose(null, null)}>
              {t('inventory.card.proxy.continueNoProxy')}
            </Button>
          </>
        }
      >
        {/* Ответ прокси — дословно, второй строкой: он бывает длинным и не всегда осмысленным. */}
        <ModalStatus tone="warn" title={t('inventory.card.proxy.failBody')} hint={failed.message} />
      </Modal>
    );
  }

  const groups = groupProxiesByFolder(proxies, folders);
  // One group is just the flat list it always was — a lone «Без папки» header over every row explains nothing.
  const headed = groups.length > 1;

  /** Address and last check on one line under the name. */
  const rowHint = (p: ProxyEntry) => {
    const detail = proxyDetail(p);
    const res = p.test;
    return (
      <>
        {detail ? `${detail} · ` : ''}
        {res ? (
          <span className={res.ok ? s.ok : s.bad}>
            {res.ok
              ? t('inventory.card.proxy.statusValid')
              : t('inventory.card.proxy.statusInvalid')}{' '}
            ({formatAgo(res.checkedAt, i18n.language)})
            {res.ok && res.ms !== undefined
              ? ` · ${t('inventory.card.proxy.ping', { ms: res.ms })}`
              : ''}
          </span>
        ) : (
          t('inventory.card.proxy.statusUnchecked')
        )}
      </>
    );
  };

  return (
    <Modal
      title={t(
        mode === 'pin' ? 'inventory.card.proxy.pinTitle' : 'inventory.card.proxy.selectTitle',
      )}
      size="md"
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('inventory.local.cancel')}
          </Button>
        </>
      }
    >
      {/* Only in `pin`: the two modes look alike, and without this line the difference between «войти через». */}
      {mode === 'pin' && <ModalHint>{t('inventory.card.proxy.pinHint')}</ModalHint>}
      <ModalOption
        icon={ShieldOff}
        title={t(mode === 'pin' ? 'inventory.card.proxy.pinNone' : 'inventory.card.proxy.none')}
        action={mode === 'pin' ? 'pick' : 'go'}
        selected={mode === 'pin' && !currentId}
        onClick={() => onChoose(null, null)}
      />
      {groups.map(({ folder, items }) => (
        <ModalSection key={folder?.id ?? 'none'}>
          {headed && (
            <ModalGroup>{folder ? folder.name : t('settings.proxy.folderNone')}</ModalGroup>
          )}
          {items.map((p) => (
            <ModalOption
              key={p.id}
              icon={Globe}
              title={proxyName(p)}
              hint={rowHint(p)}
              action={mode === 'pin' ? 'pick' : 'go'}
              selected={mode === 'pin' && p.id === currentId}
              onClick={() => void select(p)}
            />
          ))}
        </ModalSection>
      ))}
    </Modal>
  );
};

import type { ProxyEntry, ProxyFolder, ServiceId } from '@shared-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { inFolder } from '~/lib/proxy';
import { patchSettings, useSettings } from '~/stores/settings';
import {
  ModalCheck,
  ModalChecks,
  ModalChip,
  ModalChips,
  ModalWarn,
} from '~/widgets/Modal/ModalKit';
import s from './Base.module.scss';

/** Everything the «раскидать по прокси» row needs, in one object. */
export interface ProxySpread {
  /** Every proxy the service may use, folders aside. */
  all: ProxyEntry[];
  /** Only folders that actually hold one of `all` — an empty folder is noise here. */
  folders: ProxyFolder[];
  /** `null` — the whole pool. */
  folderId: string | null;
  setFolderId: (id: string | null) => void;
  spread: boolean;
  setSpread: (on: boolean) => void;
  /** What the chosen folder leaves to spread over. */
  proxies: ProxyEntry[];
  /** Ready for `onStart` — already empty when the box is off or the pool is. */
  proxyIds: string[];
}

/** The proxy side of a mass run, for one service. */
export const useProxySpread = (service: ServiceId): ProxySpread => {
  const settings = useSettings((st) => st.settings);
  const [spread, setSpread] = useState(true);
  // `undefined` = the user has not touched the chips in this modal, so the remembered folder still speaks for them.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);

  // The same two gates the login flow checks, and the same two main checks again.
  const all =
    settings?.proxyEnabled && settings.proxyServices.includes(service) ? settings.proxies : [];
  const allFolders = settings?.proxyFolders ?? [];
  const folders = allFolders.filter((f) => inFolder(all, allFolders, f.id).length > 0);

  const remembered = settings?.proxySpreadFolders?.[service] ?? null;
  const wanted = chosen === undefined ? remembered : chosen;
  const folderId = wanted && folders.some((f) => f.id === wanted) ? wanted : null;

  const setFolderId = (id: string | null) => {
    setChosen(id);
    const next = { ...(settings?.proxySpreadFolders ?? {}) };
    if (id) next[service] = id;
    else delete next[service];
    void patchSettings({ proxySpreadFolders: next });
  };

  const proxies = folderId ? inFolder(all, allFolders, folderId) : all;

  return {
    all,
    folders,
    folderId,
    setFolderId,
    spread,
    setSpread,
    proxies,
    proxyIds: spread ? proxies.map((p) => p.id) : [],
  };
};

interface ProxySpreadRowProps {
  state: ProxySpread;
  /** Why spreading matters for *this* run — the one line that differs per modal. */
  hint: string;
  /** Shown instead of the row when the service has no proxies at all. */
  noProxy: string;
}

export const ProxySpreadRow = ({ state, hint, noProxy }: ProxySpreadRowProps) => {
  const { t } = useTranslation();
  const { all, folders, folderId, setFolderId, spread, setSpread, proxies } = state;

  if (all.length === 0) return <ModalWarn>{noProxy}</ModalWarn>;

  return (
    <>
      <ModalChecks>
        <ModalCheck checked={spread} onChange={setSpread} hint={hint}>
          {t('base.check.spread', { count: proxies.length })}
        </ModalCheck>
      </ModalChecks>

      {/* Папки имеют смысл, только пока галочка стоит — иначе под выключенным флажком остаётся ряд чипов, которые просятся. */}
      {spread && folders.length > 0 && (
        <div className={s.spreadFolders}>
          <ModalChips>
            <ModalChip
              label={t('base.proxySpread.all')}
              count={all.length}
              selected={folderId === null}
              onClick={() => setFolderId(null)}
            />
            {folders.map((f) => (
              <ModalChip
                key={f.id}
                label={f.name}
                count={inFolder(all, folders, f.id).length}
                selected={folderId === f.id}
                onClick={() => setFolderId(f.id)}
              />
            ))}
          </ModalChips>
        </div>
      )}
    </>
  );
};

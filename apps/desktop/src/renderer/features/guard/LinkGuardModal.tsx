import type { AccountSummary } from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { groupProxiesByFolder, proxyName } from '~/lib/proxy';
import { useSettings } from '~/stores/settings';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalError,
  ModalField,
  ModalHint,
  ModalInput,
  ModalSelect,
  type ModalSelectItem,
  ModalSpacer,
  ModalWarn,
} from '~/widgets/Modal/ModalKit';

interface LinkGuardModalProps {
  item: AccountSummary;
  onClose: () => void;
}

/** The one-time mobile sign-in that everything else in Guard rests on. */
export const LinkGuardModal = ({ item, onClose }: LinkGuardModalProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useSettings((st) => st.settings);

  const [proxyId, setProxyId] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [needsEmailCode, setNeedsEmailCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proxies = settings?.proxyEnabled ? (settings.proxies ?? []) : [];
  const proxyGroups = groupProxiesByFolder(proxies, settings?.proxyFolders ?? []);
  const proxyItems: ModalSelectItem[] = [
    { value: '', label: t('guard.link.noProxy') },
    ...proxyGroups.flatMap(({ folder, items }) =>
      items.map((proxy) => ({
        value: proxy.id,
        label: proxyName(proxy),
        // Одна группа — тот же плоский список, каким он был всегда.
        ...(proxyGroups.length > 1
          ? { group: folder ? folder.name : t('settings.proxy.folderNone') }
          : {}),
      })),
    ),
  ];
  const bought = item.itemId > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await window.launcher.steamGuard.link(item.itemId, {
      proxyId: proxyId || null,
      ...(emailCode.trim() ? { emailCode: emailCode.trim() } : {}),
    });
    setBusy(false);

    if (result.ok) {
      await qc.invalidateQueries({ queryKey: ['guard-status', item.itemId] });
      await qc.invalidateQueries({ queryKey: ['guard-code', item.itemId] });
      onClose();
      return;
    }
    if (result.reason === 'needs_email_code') {
      setNeedsEmailCode(true);
      setError(null);
      return;
    }
    const reason = t(`guard.error.${result.reason}`);
    setError(result.message ? `${reason}: ${result.message}` : reason);
  };

  return (
    <Modal
      title={t('guard.link.title')}
      onClose={busy ? undefined : onClose}
      closable={!busy}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t('guard.link.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={needsEmailCode && !emailCode.trim()}
            onClick={submit}
          >
            {t('guard.link.confirm')}
          </Button>
        </>
      }
    >
      <ModalHint>{t('guard.link.explain')}</ModalHint>

      {/* Над полями, а не под кнопкой: и снятая гарантия. */}
      <ModalWarn>
        {bought ? t('guard.link.warrantyWarning') : t('guard.link.sessionWarning')}
      </ModalWarn>

      {proxies.length > 0 && (
        <ModalField label={t('guard.link.proxy')} note={t('guard.link.proxyHint')}>
          <ModalSelect value={proxyId} onChange={setProxyId} items={proxyItems} disabled={busy} />
        </ModalField>
      )}

      {needsEmailCode && (
        <ModalField label={t('guard.link.emailCode')} note={t('guard.link.emailCodeHint')}>
          <ModalInput
            value={emailCode}
            onChange={(e) => setEmailCode(e.target.value)}
            placeholder="XXXXX"
            disabled={busy}
            // Поле появилось в ответ на «нужен код» — писать будут сюда.
            autoFocus
          />
        </ModalField>
      )}

      <ModalError>{error}</ModalError>
    </Modal>
  );
};

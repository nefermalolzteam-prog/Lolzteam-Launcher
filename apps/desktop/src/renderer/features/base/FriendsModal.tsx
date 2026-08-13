import type { SteamFriendTarget, SteamFriendsRequest } from '@shared-types';
import { STEAM_FRIEND_TARGETS } from '@shared-types';
import { UserRoundX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalCheck,
  ModalChecks,
  ModalError,
  ModalGroup,
  ModalHint,
  ModalSpacer,
  ModalWarn,
} from '~/widgets/Modal/ModalKit';
import { ProxySpreadRow, useProxySpread } from './ProxySpreadRow';

interface FriendsModalProps {
  count: number;
  /** Set when main refused the run — `busy`, or nothing selected. */
  error: string | null;
  onCancel: () => void;
  onStart: (req: Omit<SteamFriendsRequest, 'accountIds'>) => void;
}

export const FriendsModal = ({ count, error, onCancel, onStart }: FriendsModalProps) => {
  const { t } = useTranslation();

  const [targets, setTargets] = useState<ReadonlySet<SteamFriendTarget>>(new Set());
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  // The Steam proxies, not the Telegram ones: the run mints this account's own cookies through them.
  const proxy = useProxySpread('steam');

  const toggle = (target: SteamFriendTarget): void =>
    setTargets((prev) => {
      const next = new Set(prev);
      if (!next.delete(target)) next.add(target);
      return next;
    });

  const nothing = targets.size === 0;

  const start = (): void => {
    if (busy || nothing) return;
    setBusy(true);
    onStart({
      targets: [...targets],
      block,
      proxyIds: proxy.proxyIds,
    });
  };

  // Re-enable on refusal, so the choice can be corrected without reopening.
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  return (
    <Modal
      title={t('base.friends.title')}
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('base.check.cancel')}
          </Button>
          {/* Подпись кнопки меняется вместе с переключателем: «убрать» и «убрать и заблокировать» — разные вещи. */}
          <Button
            variant="danger"
            size="sm"
            icon={UserRoundX}
            busy={busy}
            disabled={nothing}
            title={nothing ? t('base.friends.nothingToDo') : undefined}
            onClick={start}
          >
            {t(block ? 'base.friends.startBlock' : 'base.friends.start')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>{t('base.friends.lead', { count })}</ModalHint>

      <ModalGroup>{t('base.friends.targets')}</ModalGroup>
      <ModalChecks>
        {STEAM_FRIEND_TARGETS.map((it) => (
          <ModalCheck
            key={it}
            checked={targets.has(it)}
            onChange={() => toggle(it)}
            hint={t(`base.friends.targetHint.${it}`)}
          >
            {t(`base.friends.target.${it}`)}
          </ModalCheck>
        ))}
      </ModalChecks>

      {/* Отдельным столбиком, а не пятой строкой в предыдущем: те четыре отвечают на «что убрать», а этот — на «как». */}
      <ModalChecks>
        <ModalCheck checked={block} onChange={setBlock} hint={t('base.friends.blockHint')}>
          {t('base.friends.block')}
        </ModalCheck>
      </ModalChecks>

      <ProxySpreadRow
        state={proxy}
        hint={t('base.check.spreadHint')}
        noProxy={t('base.friends.noProxy')}
      />

      {/* Said plainly, and above the button rather than under a checkbox: this is a write, it is not undoable. */}
      <ModalWarn>{t('base.friends.warn')}</ModalWarn>
    </Modal>
  );
};

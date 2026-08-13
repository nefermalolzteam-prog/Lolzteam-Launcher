import type { TelegramCleanupRequest, TelegramCleanupTarget } from '@shared-types';
import { TELEGRAM_CLEANUP_TARGETS } from '@shared-types';
import { Eraser } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
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

interface CleanupModalProps {
  count: number;
  /** Set when main refused the run — `busy`, or nothing selected. */
  error: string | null;
  onCancel: () => void;
  onStart: (req: Omit<TelegramCleanupRequest, 'accountIds'>) => void;
}

/** The two that hold no correspondence with anyone, and that a resale always wants gone. */
const DEFAULT_TARGETS: readonly TelegramCleanupTarget[] = ['saved', 'service'];

export const CleanupModal = ({ count, error, onCancel, onStart }: CleanupModalProps) => {
  const { t } = useTranslation();

  const [targets, setTargets] = useState<ReadonlySet<TelegramCleanupTarget>>(
    () => new Set(DEFAULT_TARGETS),
  );
  const [includeArchived, setIncludeArchived] = useState(false);
  const [revokePrivate, setRevokePrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const proxy = useProxySpread('telegram');

  const toggle = (target: TelegramCleanupTarget): void =>
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
      includeArchived,
      // Meaningless without the target it belongs.
      revokePrivate: revokePrivate && targets.has('private'),
      proxyIds: proxy.proxyIds,
    });
  };

  // Re-enable on refusal, so the choice can be corrected without reopening.
  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  return (
    <Modal
      title={t('base.cleanup.title')}
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('base.check.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon={Eraser}
            busy={busy}
            disabled={nothing}
            title={nothing ? t('base.cleanup.nothingToDo') : undefined}
            onClick={start}
          >
            {t('base.cleanup.start')}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>{t('base.cleanup.lead', { count })}</ModalHint>

      <ModalGroup>{t('base.cleanup.targets')}</ModalGroup>
      <ModalChecks>
        {TELEGRAM_CLEANUP_TARGETS.map((it) => (
          <Fragment key={it}>
            <ModalCheck
              checked={targets.has(it)}
              onChange={() => toggle(it)}
              hint={t(
                it === 'private' && revokePrivate
                  ? 'base.cleanup.targetHint.privateRevoke'
                  : `base.cleanup.targetHint.${it}`,
              )}
            >
              {t(`base.cleanup.target.${it}`)}
            </ModalCheck>

            {/* Shown under the row it belongs to and only while that row is. */}
            {it === 'private' && targets.has('private') && (
              <ModalCheck
                nested
                checked={revokePrivate}
                onChange={setRevokePrivate}
                hint={t('base.cleanup.revokePrivateHint')}
              >
                {t('base.cleanup.revokePrivate')}
              </ModalCheck>
            )}
          </Fragment>
        ))}
      </ModalChecks>

      {/* Отдельным столбиком: те строки отвечают на «что удалить», а эта — на «где искать», и пятой целью она бы не была. */}
      <ModalChecks>
        <ModalCheck
          checked={includeArchived}
          onChange={setIncludeArchived}
          hint={t('base.cleanup.includeArchivedHint')}
        >
          {t('base.cleanup.includeArchived')}
        </ModalCheck>
      </ModalChecks>

      <ProxySpreadRow
        state={proxy}
        hint={t('base.check.spreadHint')}
        noProxy={t('base.check.noProxy')}
      />

      {/* Said once, plainly, and not as a hint under a checkbox: this is the one operation in the panel that destroys something. */}
      <ModalWarn>{t('base.cleanup.warn')}</ModalWarn>
    </Modal>
  );
};

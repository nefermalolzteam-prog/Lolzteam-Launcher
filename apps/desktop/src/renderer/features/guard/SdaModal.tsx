import type { AccountSummary } from '@shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, ListChecks, Loader2, QrCode, Unlink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalOption, ModalSpacer } from '~/widgets/Modal/ModalKit';
import { CheckIcon, CopyIcon } from '~/widgets/icons/Icons';
import { ApproveLoginModal } from './ApproveLoginModal';
import { ConfirmationsModal } from './ConfirmationsModal';
import { LinkGuardModal } from './LinkGuardModal';
import s from './SdaModal.module.scss';

/** Matches `CODE_PERIOD_SECONDS` in main; only the ring geometry depends on it. */
const PERIOD = 30;
const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Local wall clock, once a second. */
const useSecondTick = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

/** Which screen the flow is on. */
type Screen = 'home' | 'approve' | 'link' | 'confirmations';

interface SdaModalProps {
  item: AccountSummary;
  onClose: () => void;
}

/** One account's authenticator, opened from its card. */
export const SdaModal = ({ item, onClose }: SdaModalProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const now = useSecondTick();
  const [screen, setScreen] = useState<Screen>('home');
  const [copied, setCopied] = useState(false);

  const status = useQuery({
    queryKey: ['guard-status', item.itemId],
    queryFn: () => window.launcher.steamGuard.status(item.itemId),
  });

  const hasSecret = status.data?.hasSharedSecret ?? false;

  const code = useQuery({
    queryKey: ['guard-code', item.itemId],
    queryFn: () => window.launcher.steamGuard.code(item.itemId),
    enabled: hasSecret,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  const result = code.data;
  const elapsed = (now - code.dataUpdatedAt) / 1000;
  const remaining =
    result?.ok && code.dataUpdatedAt > 0
      ? Math.max(0, Math.ceil(result.code.secondsRemaining - elapsed))
      : 0;

  // The modal owns the refresh, not a polling interval: exactly one request per 30-second bucket.
  useEffect(() => {
    if (!result?.ok || code.isFetching) return;
    if (remaining > 0) return;
    void code.refetch();
  }, [remaining, result, code.isFetching, code.refetch]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    if (!result?.ok) return;
    await navigator.clipboard.writeText(result.code.code);
    setCopied(true);
  };

  const unlink = async () => {
    await window.launcher.steamGuard.unlink(item.itemId);
    await qc.invalidateQueries({ queryKey: ['guard-status', item.itemId] });
    qc.removeQueries({ queryKey: ['guard-code', item.itemId] });
  };

  const linked = status.data?.linked ?? false;
  const canConfirm = linked && (status.data?.hasIdentitySecret ?? false);
  const ready = Boolean(result?.ok);
  const home = () => setScreen('home');

  if (screen === 'approve') return <ApproveLoginModal item={item} onClose={home} />;
  if (screen === 'link') return <LinkGuardModal item={item} onClose={home} />;
  if (screen === 'confirmations') return <ConfirmationsModal item={item} onClose={home} />;

  return (
    <Modal
      title={t('guard.title')}
      subtitle={item.title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {/* Код — единственное, ради чего окно открывают чаще всего, поэтому он и крупнее всего остального, и нажимается целиком. */}
      {ready && result?.ok ? (
        <button
          type="button"
          className={s.codeRow}
          onClick={copy}
          title={t('guard.card.copyHint')}
          aria-label={t('guard.card.copyHint')}
        >
          <span className={s.code}>{result.code.code}</span>
          <span className={s.ring} aria-hidden="true">
            <svg viewBox="0 0 32 32" width="32" height="32">
              <circle className={s.ringTrack} cx="16" cy="16" r={RING_RADIUS} />
              <circle
                className={s.ringFill}
                cx="16"
                cy="16"
                r={RING_RADIUS}
                strokeDasharray={RING_LENGTH}
                strokeDashoffset={RING_LENGTH * (1 - remaining / PERIOD)}
              />
            </svg>
            <span className={s.ringLabel}>{remaining}</span>
          </span>
          <span className={s.copyIcon}>
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          </span>
        </button>
      ) : (
        <div className={s.codePlaceholder}>
          {status.isLoading || code.isLoading ? (
            <Loader2 className={s.spin} size={16} aria-hidden />
          ) : (
            <span className={s.placeholderText}>
              {hasSecret ? t('guard.card.codeFailed') : t('guard.card.noSecret')}
            </span>
          )}
        </div>
      )}

      <div className={s.rows}>
        <ModalOption
          icon={QrCode}
          title={t('guard.approve.action')}
          hint={linked ? undefined : t('guard.card.linkFirst')}
          action="go"
          disabled={!linked}
          onClick={() => setScreen('approve')}
        />
        {/* Confirmations need an identity_secret, which plenty of maFiles lack. */}
        <ModalOption
          icon={ListChecks}
          title={t('guard.confirm.action')}
          hint={canConfirm ? undefined : t('guard.card.noIdentity')}
          action="go"
          disabled={!canConfirm}
          onClick={() => setScreen('confirmations')}
        />
        {linked ? (
          <ModalOption
            icon={Unlink}
            title={t('guard.card.unlink')}
            hint={status.data?.accountName ?? t('guard.card.linked')}
            action="none"
            onClick={() => void unlink()}
          />
        ) : (
          <ModalOption
            icon={KeyRound}
            title={t('guard.card.link')}
            hint={t('guard.card.notLinked')}
            action="go"
            onClick={() => setScreen('link')}
          />
        )}
      </div>
    </Modal>
  );
};

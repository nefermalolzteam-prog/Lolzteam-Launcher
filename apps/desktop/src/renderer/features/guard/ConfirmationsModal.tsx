import type {
  AccountSummary,
  GuardConfirmation,
  GuardConfirmationAction,
  GuardResult,
} from '@shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalEmpty,
  ModalError,
  ModalHint,
  ModalNote,
  ModalSpacer,
  ModalStatus,
} from '~/widgets/Modal/ModalKit';
import s from './ConfirmationsModal.module.scss';

interface ConfirmationsModalProps {
  item: AccountSummary;
  onClose: () => void;
}

/** Why the list is empty, when it is empty for a reason. */
const failureText = (
  result: GuardResult<{ confirmations: GuardConfirmation[] }> | undefined,
  t: (key: string) => string,
): string | null => {
  if (!result || result.ok) return null;
  if (result.reason === 'no_identity_secret') return t('guard.confirm.noIdentitySecret');
  const reason = t(`guard.error.${result.reason}`);
  return result.message ? `${reason}: ${result.message}` : reason;
};

/** The pending trade and market confirmations for one account. */
export const ConfirmationsModal = ({ item, onClose }: ConfirmationsModalProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState<GuardConfirmationAction | null>(null);
  /** Which single row is in flight, so only its own buttons show a spinner. */
  const [pending, setPending] = useState<string | null>(null);

  const key = ['guard-confirmations', item.itemId];

  const list = useQuery({
    queryKey: key,
    queryFn: () => window.launcher.steamGuard.confirmations(item.itemId),
    refetchOnWindowFocus: false,
  });

  const act = useMutation({
    mutationFn: ({
      action,
      items,
    }: {
      action: GuardConfirmationAction;
      items: GuardConfirmation[];
    }) => window.launcher.steamGuard.confirmationsAct(item.itemId, action, items),
    onSuccess: async (result) => {
      if (!result.ok) {
        const reason = t(`guard.error.${result.reason}`);
        setError(result.message ? `${reason}: ${result.message}` : reason);
        return;
      }
      setError(null);
      // Steam takes a moment to drop an acted-on item from the list.
      await qc.invalidateQueries({ queryKey: key });
    },
    onSettled: () => {
      setPending(null);
      setBulk(null);
    },
  });

  const run = (action: GuardConfirmationAction, items: GuardConfirmation[]) => {
    setError(null);
    act.mutate({ action, items });
  };

  const result = list.data;
  const confirmations = result?.ok ? result.confirmations : [];
  const failure = failureText(result, t);
  const busy = act.isPending;

  /** Значок строки: у одной кнопки на строку — вертушка, у остальных — свой глиф. */
  const rowIcon = (conf: GuardConfirmation, action: GuardConfirmationAction) => {
    if (pending === conf.id && act.variables?.action === action) {
      return <Loader2 className={s.spin} size={16} />;
    }
    return action === 'allow' ? <Check size={16} /> : <X size={16} />;
  };

  /** Ответ на «точно всё?» живёт в футере, а не полосой над ним. */
  const footer = bulk ? (
    <>
      <ModalNote>
        {t(bulk === 'allow' ? 'guard.confirm.allowAllAsk' : 'guard.confirm.cancelAllAsk', {
          count: confirmations.length,
        })}
      </ModalNote>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setBulk(null)}>
        {t('guard.confirm.back')}
      </Button>
      <Button
        variant={bulk === 'allow' ? 'accent' : 'danger'}
        size="sm"
        busy={busy}
        onClick={() => run(bulk, confirmations)}
      >
        {t('guard.confirm.confirm')}
      </Button>
    </>
  ) : confirmations.length > 0 ? (
    <>
      <Button variant="danger" size="sm" disabled={busy} onClick={() => setBulk('cancel')}>
        {t('guard.confirm.cancelAll')}
      </Button>
      <ModalSpacer />
      <Button variant="accent" size="sm" disabled={busy} onClick={() => setBulk('allow')}>
        {t('guard.confirm.allowAll')}
      </Button>
    </>
  ) : (
    <>
      <ModalSpacer />
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t('common.close')}
      </Button>
    </>
  );

  return (
    <Modal
      title={t('guard.confirm.title')}
      subtitle={item.title}
      size="lg"
      onClose={onClose}
      closable
      footer={footer}
    >
      {/* Обновление — у списка, а не в футере: перечитывают именно. */}
      <div className={s.head}>
        <ModalHint>{t('guard.confirm.explain', { account: item.title })}</ModalHint>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={RefreshCw}
          label={t('guard.confirm.refresh')}
          busy={list.isFetching}
          disabled={busy}
          onClick={() => void list.refetch()}
        />
      </div>

      {list.isLoading ? (
        <ModalStatus tone="busy" title={t('guard.confirm.loading')} />
      ) : failure ? (
        <ModalStatus tone="bad" title={t('guard.confirm.failed')} hint={failure} />
      ) : confirmations.length === 0 ? (
        <ModalEmpty>{t('guard.confirm.empty')}</ModalEmpty>
      ) : (
        <ul className={s.list}>
          {confirmations.map((conf) => (
            <li key={conf.id} className={s.row}>
              {conf.icon ? (
                <img className={s.icon} src={conf.icon} alt="" />
              ) : (
                <div className={s.iconFallback} aria-hidden="true" />
              )}
              <div className={s.info}>
                <span className={s.headline}>{conf.headline || conf.typeName}</span>
                {conf.summary.map((line) => (
                  <span key={line} className={s.summary}>
                    {line}
                  </span>
                ))}
                {conf.warning && (
                  <span className={s.rowWarning}>
                    <AlertTriangle size={12} />
                    {conf.warning}
                  </span>
                )}
              </div>
              <div className={s.rowActions}>
                <button
                  type="button"
                  className={s.allow}
                  onClick={() => {
                    setPending(conf.id);
                    run('allow', [conf]);
                  }}
                  disabled={busy}
                  title={t('guard.confirm.allow')}
                  aria-label={t('guard.confirm.allow')}
                >
                  {rowIcon(conf, 'allow')}
                </button>
                <button
                  type="button"
                  className={s.deny}
                  onClick={() => {
                    setPending(conf.id);
                    run('cancel', [conf]);
                  }}
                  disabled={busy}
                  title={t('guard.confirm.cancel')}
                  aria-label={t('guard.confirm.cancel')}
                >
                  {rowIcon(conf, 'cancel')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ModalError>{error}</ModalError>
    </Modal>
  );
};

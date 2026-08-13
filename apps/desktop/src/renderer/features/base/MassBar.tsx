import type {
  AccountSummary,
  SteamFriendsRequest,
  TelegramCleanupRequest,
  TelegramPrivacyRequest,
  TelegramProfileRequest,
} from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localErrorText } from '~/features/inventory/localErrors';
import { type MassActionId, useInventorySelection } from '~/stores/inventorySelection';
import {
  cancelTelegramRun,
  startSteamCheck,
  startSteamFriendsPurge,
  startSteamLink,
  startTelegramCheck,
  startTelegramCleanup,
  startTelegramPrivacy,
  startTelegramProfileFill,
  useTelegramTasks,
} from '~/stores/telegramTasks';
import { TrashIcon } from '~/widgets/icons/Icons';
import s from './Base.module.scss';
import { CheckModal } from './CheckModal';
import { CleanupModal } from './CleanupModal';
import { DeleteModal } from './DeleteModal';
import { FriendsModal } from './FriendsModal';
import { LinkModal } from './LinkModal';
import { PrivacyModal } from './PrivacyModal';
import { ProfileModal } from './ProfileModal';
import { SteamCheckModal } from './SteamCheckModal';
import { MASS_ACTIONS, massActionState } from './actions';
import { runMassDelete } from './massDelete';
import { massSelection } from './selection';

interface MassBarProps {
  /** The accounts a mass operation can be run on, in the order the grid shows them — already narrowed by the scope. */
  candidates: readonly AccountSummary[];
}

export const MassBar = ({ candidates }: MassBarProps) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ids = useInventorySelection((st) => st.ids);
  const replace = useInventorySelection((st) => st.replace);
  const clearSelection = useInventorySelection((st) => st.clear);
  const pending = useInventorySelection((st) => st.pending);
  const [asking, setAsking] = useState<MassActionId | null>(null);
  /** Why the last start was refused, in the modal that asked for it. */
  const [refused, setRefused] = useState<string | null>(null);
  /** The deletion, kept apart from `asking`. */
  const [askDelete, setAskDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** A single card asked for one of these actions on itself. */
  useEffect(() => {
    if (!pending) return;
    setRefused(null);
    setAsking(pending);
    useInventorySelection.getState().clearPending();
  }, [pending]);

  const rows = useTelegramTasks((st) => st.rows);
  const running = useTelegramTasks((st) => st.running);
  const summary = useTelegramTasks((st) => st.summary);

  /** The selection, as one set: what the counter shows, what decides the service, and what every run below is handed. */
  const selection = useMemo(() => massSelection(candidates, ids), [candidates, ids]);
  const chosen = selection.count;
  const allOn = candidates.length > 0 && chosen === candidates.length;
  // Announced as `mixed`, which is a state `role="checkbox"` has and this bar spends most of its life.
  const someOn = chosen > 0 && !allOn;
  const service = selection.service;
  const mixed = selection.mixed;

  const toggleAll = (): void => {
    if (allOn) {
      // Only what is on screen is cleared; a selection made under another filter stays where the user left it.
      const next = new Set(ids);
      for (const it of candidates) next.delete(it.itemId);
      replace(next);
    } else {
      replace([...ids, ...candidates.map((it) => it.itemId)]);
    }
  };

  /** The Telegram check, on exactly the accounts the panel counted. */
  const runCheck = (options: {
    withSpam: boolean;
    withSessions: boolean;
    withAvatar: boolean;
    proxyIds: string[];
  }): void => {
    setRefused(null);
    void startTelegramCheck({ accountIds: [...selection.ids], ...options }).then((res) => {
      if (res.ok) setAsking(null);
      else setRefused(t(`base.check.refused.${res.reason}`));
    });
  };

  /** The Steam run, on exactly the accounts the panel counted. */
  const runSteamCheck = (options: { proxyIds: string[] }): void => {
    setRefused(null);
    void startSteamCheck({ accountIds: [...selection.ids], ...options }).then((res) => {
      if (res.ok) setAsking(null);
      else setRefused(t(`base.steamCheck.refused.${res.reason}`));
    });
  };

  /** The profile modal stays open on refusal. */
  const runProfile = (req: Omit<TelegramProfileRequest, 'accountIds'>): void => {
    setRefused(null);
    void startTelegramProfileFill({ accountIds: [...selection.ids], ...req }).then((res) => {
      if (res.ok) setAsking(null);
      else setRefused(t(`base.profile.refused.${res.reason}`));
    });
  };

  /** The cleanup and the privacy run, refused the same way. */
  const runCleanup = (req: Omit<TelegramCleanupRequest, 'accountIds'>): void => {
    setRefused(null);
    void startTelegramCleanup({ accountIds: [...selection.ids], ...req }).then((res) => {
      if (res.ok) setAsking(null);
      else setRefused(t(`base.cleanup.refused.${res.reason}`));
    });
  };

  const runPrivacy = (req: Omit<TelegramPrivacyRequest, 'accountIds'>): void => {
    setRefused(null);
    void startTelegramPrivacy({ accountIds: [...selection.ids], ...req }).then((res) => {
      if (res.ok) setAsking(null);
      else setRefused(t(`base.privacy.refused.${res.reason}`));
    });
  };

  /** The friends purge, refused the same way — with one reason of its own. */
  const runFriends = (req: Omit<SteamFriendsRequest, 'accountIds'>): void => {
    setRefused(null);
    void startSteamFriendsPurge({ accountIds: [...selection.ids], ...req }).then((res) => {
      if (res.ok) setAsking(null);
      else setRefused(t(`base.friends.refused.${res.reason}`));
    });
  };

  /** The mass authenticator link, refused the same way. */
  const runLink = (options: { proxyIds: string[] }): void => {
    setRefused(null);
    void startSteamLink({ accountIds: [...selection.ids], ...options }).then((res) => {
      if (res.ok) setAsking(null);
      else setRefused(t(`base.link.refused.${res.reason}`));
    });
  };

  /** The deletion, on exactly the accounts the panel counted. */
  const confirmDelete = async (): Promise<void> => {
    if (deleting) return;
    const targets = [...selection.ids];
    if (targets.length === 0) {
      setAskDelete(false);
      return;
    }
    setDeleting(true);
    setDeleted(0);
    setDeleteError(null);

    const outcome = await runMassDelete(targets, (id) => window.launcher.localAccounts.remove(id), {
      onProgress: (done) => setDeleted(done),
    });

    if (outcome.removed.length > 0) {
      const next = new Set(ids);
      for (const id of outcome.removed) next.delete(id);
      replace(next);
      await qc.invalidateQueries({ queryKey: ['accounts'] });
    }

    setDeleting(false);
    if (outcome.failed.length === 0) {
      setAskDelete(false);
      return;
    }
    // Named by reason rather than by id: «not_found» on twelve accounts is one sentence.
    const reasons = [...new Set(outcome.failed.map((f) => f.message))]
      .map((code) => localErrorText(t, code))
      .join('; ');
    setDeleteError(`${t('base.delete.failed', { count: outcome.failed.length })} ${reasons}`);
  };

  // The runner takes one run at a time, so every action waits on the one in flight rather than queueing behind it.
  const idle = !running;
  const done =
    rows.size === 0
      ? 0
      : [...rows.values()].filter((r) => r.state !== 'queued' && r.state !== 'running').length;

  return (
    <div className={s.massDock}>
      {(running || summary) && (
        <div className={s.massRun}>
          <span className={s.runText}>
            {running && <Loader2 size={14} className={s.spin} />}
            <span>
              {running
                ? t('base.run.progress', { done, total: rows.size })
                : t('base.run.finished', { ok: summary?.ok ?? 0, failed: summary?.failed ?? 0 })}
            </span>
            {!running && summary?.stopped && (
              <span className={s.hint}>{t(`base.run.stopped.${summary.stopped}`)}</span>
            )}
          </span>
          <button
            type="button"
            className={s.link}
            onClick={() => (running ? cancelTelegramRun() : useTelegramTasks.getState().clear())}
          >
            <X size={13} />
            <span>{t(running ? 'base.run.cancel' : 'base.run.clear')}</span>
          </button>
        </div>
      )}

      <div className={s.massBar}>
        {/* The count and «выделить всё» are one control: the number says what the click acts on, the box says what the click does. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={someOn ? 'mixed' : allOn}
          aria-label={`${t('base.selectAll')} — ${t('base.selectedCount', {
            count: chosen,
            total: candidates.length,
          })}`}
          title={t('base.selectAll')}
          className={s.massChip}
          onClick={toggleAll}
          disabled={candidates.length === 0}
        >
          <span
            className={`${s.checkbox} ${allOn ? s.checkboxOn : ''} ${someOn ? s.checkboxSome : ''}`}
          />
          <span className={s.massCount}>{chosen}</span>
          <span className={s.massTotal}>{t('base.selectedOf', { total: candidates.length })}</span>
        </button>

        <span className={s.massDivider} />

        <div className={s.massActions}>
          {MASS_ACTIONS.map((action) => {
            // The table decides; the bar only draws what it says.
            const state = massActionState(action, service, mixed);
            if (!state.visible) return null;
            const reason = state.reasonKey ? t(state.reasonKey) : undefined;
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                className={`${s.massAction} ${action.lead ? s.massActionLead : ''}`}
                disabled={!state.enabled || !idle || chosen === 0}
                title={reason}
                onClick={
                  state.enabled
                    ? () => {
                        setRefused(null);
                        setAsking(action.id);
                      }
                    : undefined
                }
              >
                <Icon size={18} />
                <span>{t(`base.actions.${action.id}`)}</span>
              </button>
            );
          })}
        </div>

        <span className={s.massDivider} />

        {/* Deleting the selection. */}
        <button
          type="button"
          className={s.massDanger}
          onClick={() => {
            setDeleteError(null);
            setDeleted(0);
            setAskDelete(true);
          }}
          title={t('base.delete.title')}
          aria-label={t('base.delete.title')}
          disabled={!idle || chosen === 0}
        >
          <TrashIcon size={18} />
          <span>{t('base.delete.action')}</span>
        </button>

        <span className={s.massDivider} />

        {/* The way out of the selection. */}
        <button
          type="button"
          className={s.massClose}
          onClick={clearSelection}
          title={t('base.clearSelection')}
          aria-label={t('base.clearSelection')}
          disabled={running || chosen === 0}
        >
          <X size={16} />
        </button>
      </div>

      {asking === 'check' &&
        (service === 'steam' ? (
          <SteamCheckModal
            count={chosen}
            error={refused}
            onCancel={() => setAsking(null)}
            onStart={runSteamCheck}
          />
        ) : (
          <CheckModal
            count={chosen}
            error={refused}
            onCancel={() => setAsking(null)}
            onStart={runCheck}
          />
        ))}
      {asking === 'profile' && (
        <ProfileModal
          count={chosen}
          error={refused}
          onCancel={() => setAsking(null)}
          onStart={runProfile}
        />
      )}
      {asking === 'cleanup' && (
        <CleanupModal
          count={chosen}
          error={refused}
          onCancel={() => setAsking(null)}
          onStart={runCleanup}
        />
      )}
      {asking === 'privacy' && (
        <PrivacyModal
          count={chosen}
          error={refused}
          onCancel={() => setAsking(null)}
          onStart={runPrivacy}
        />
      )}
      {asking === 'friends' && (
        <FriendsModal
          count={chosen}
          error={refused}
          onCancel={() => setAsking(null)}
          onStart={runFriends}
        />
      )}
      {asking === 'link' && (
        <LinkModal
          count={chosen}
          error={refused}
          onCancel={() => setAsking(null)}
          onStart={runLink}
        />
      )}
      {askDelete && (
        <DeleteModal
          count={chosen}
          busy={deleting}
          done={deleted}
          error={deleteError}
          onCancel={() => setAskDelete(false)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
};

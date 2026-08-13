import type { AuthStatus } from '@shared-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ConnectionScreen } from '~/features/auth/ConnectionScreen';
import { LoginScreen } from '~/features/auth/LoginScreen';
import { DeepLinkLogin } from '~/features/inventory/DeepLinkLogin';
import { InventoryView } from '~/features/inventory/InventoryView';
import { LoginProgressModal } from '~/features/inventory/LoginProgressModal';
import { LocalImportView } from '~/features/local-import/LocalImportView';
import { MailView } from '~/features/mail/MailView';
import { MetricsConsentModal } from '~/features/metrics/MetricsConsentModal';
import { SettingsView } from '~/features/settings/SettingsView';
import { useLocaleSync } from '~/i18n/useLocaleSync';
import { useAccountsStream, useAccountsStreamController } from '~/stores/accountsStream';
import { initActionLog } from '~/stores/actionLog';
import { initInventoryFilters } from '~/stores/inventoryFilters';
import { useLoginSession } from '~/stores/loginSession';
import { useMailTarget } from '~/stores/mailTarget';
import { useNotificationCenter } from '~/stores/notifySources';
import { initSettingsStore } from '~/stores/settings';
import { useTaskCenter } from '~/stores/taskSources';
import { useTelegramTaskStream } from '~/stores/telegramTasks';
import { useUpdaterFeed } from '~/stores/updater';
import { useView } from '~/stores/view';
import { Shell } from '~/widgets/Shell/Shell';
import { Splash } from '~/widgets/Splash/Splash';

initSettingsStore();
// Reads the stored per-category filters out of those settings once they land.
initInventoryFilters();
// The journal's live feed.
initActionLog();

const AccountsStreamController = () => {
  useAccountsStreamController();
  // A «База» run outlives the grid it was started from.
  useTelegramTaskStream();
  // Restates all of the above — and the login and the updater — as the dock's task list.
  useTaskCenter();
  // …and the same events again, kept as history for the bell.
  useNotificationCenter();
  // Канал обновлений.
  useUpdaterFeed();
  return null;
};

export const App = () => {
  useLocaleSync();
  const qc = useQueryClient();
  const [splashDone, setSplashDone] = useState(false);

  const status = useQuery({
    queryKey: ['auth-status'],
    queryFn: () => window.launcher.auth.getStatus(),
  });

  const [live, setLive] = useState<AuthStatus | null>(null);

  useEffect(() => {
    const off = window.launcher.auth.onStatusChanged((next) => {
      setLive(next);
      qc.setQueryData(['auth-status'], next);
      // On logout, drop any in-flight stream state so the loading indicator doesn't stay stuck.
      if (!next.authenticated) {
        useAccountsStream.getState().reset();
        useAccountsStream.getState().setLaunchHandled(false);
        qc.setQueryData(['accounts'], []);
      }
      qc.invalidateQueries({ queryKey: ['accounts'] });
    });
    return off;
  }, [qc]);

  useEffect(() => {
    const off = window.launcher.accounts.onLoginProgress((evt) => {
      const sess = useLoginSession.getState();
      if (evt.itemId !== sess.itemId) return;
      if (sess.step === 'done' || sess.error !== null) return;
      sess.setStep(evt.step, evt.detail);
    });
    return off;
  }, []);

  useEffect(() => {
    const off = window.launcher.mail.onOpenRequest(({ emailPassword }) => {
      useMailTarget.getState().setPending(emailPassword);
      useView.getState().setView('mail');
    });
    return off;
  }, []);

  const current = live ?? status.data ?? null;
  const view = useView((st) => st.view);

  const refetchStatus = useCallback(async () => {
    setLive(null);
    const res = await status.refetch();
    return res.data;
  }, [status.refetch]);

  const loading = status.isLoading && !current;

  const offline = Boolean(current?.authenticated && (current.offline || !current.session));

  let content: React.ReactNode = null;
  if (loading) {
    content = splashDone ? <ConnectionScreen onRetry={refetchStatus} /> : null;
  } else if (!current?.authenticated) {
    content = (
      <>
        <LoginScreen />
        <LoginProgressModal />
      </>
    );
  } else if (offline) {
    content = <ConnectionScreen onRetry={refetchStatus} />;
  } else {
    content = (
      <>
        <AccountsStreamController />
        <Shell session={current.session}>
          {view === 'settings' ? (
            <SettingsView />
          ) : view === 'mail' ? (
            <MailView />
          ) : view === 'localAdd' ? (
            <LocalImportView />
          ) : (
            <InventoryView />
          )}
          <LoginProgressModal />
          <DeepLinkLogin />
        </Shell>
      </>
    );
  }

  return (
    <>
      {content}
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
      {/* After the splash: the first thing a user sees should be the app, and the question is about the app. */}
      {splashDone && <MetricsConsentModal />}
    </>
  );
};

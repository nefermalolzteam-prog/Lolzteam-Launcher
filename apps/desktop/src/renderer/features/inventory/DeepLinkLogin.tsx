import type { AccountPreview, ProxyEntry, ServiceId } from '@shared-types';
import { pinnedProxyFor } from '@shared-types';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loginMethodsFor, toLoginService } from '~/lib/loginService';
import { formatWarranty } from '~/lib/loginService';
import { type LoginMethod, useLoginSession } from '~/stores/loginSession';
import { useSettings } from '~/stores/settings';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import { ModalHint, ModalSpacer, ModalStatus, ModalWarn } from '~/widgets/Modal/ModalKit';
import { LoginMethodModal } from './LoginMethodModal';
import { ProxyChoiceModal, type ProxyTest } from './ProxyChoiceModal';

const EMPTY_PROXIES: ProxyEntry[] = [];
const EMPTY_PINS: Record<string, string> = {};
const EMPTY_SERVICES: ServiceId[] = [];
const EMPTY_PREFS: Partial<Record<ServiceId, 'native' | 'web'>> = {};

export const DeepLinkLogin = () => {
  const { t } = useTranslation();
  const [pending, setPending] = useState<AccountPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosingMethod, setChoosingMethod] = useState(false);
  const [choosingProxy, setChoosingProxy] = useState(false);
  const [method, setMethod] = useState<LoginMethod | null>(null);

  const proxyEnabled = useSettings((st) => st.settings?.proxyEnabled ?? false);
  const proxies = useSettings((st) => st.settings?.proxies ?? EMPTY_PROXIES);
  const proxyServices = useSettings((st) => st.settings?.proxyServices ?? EMPTY_SERVICES);
  const accountProxies = useSettings((st) => st.settings?.accountProxies ?? EMPTY_PINS);
  const preferredLoginMethod = useSettings(
    (st) => st.settings?.preferredLoginMethod ?? EMPTY_PREFS,
  );

  useEffect(() => {
    const off = window.launcher.accounts.onLoginRequest(({ itemId }) => {
      if (useLoginSession.getState().isOpen) return; // don't interrupt a login
      setError(null);
      setPending(null);
      setChoosingMethod(false);
      setChoosingProxy(false);
      setMethod(null);
      setLoading(true);
      window.launcher.accounts
        .preview(itemId)
        .then((details) => {
          if (!details) setError(t('deepLink.notFound'));
          else if (!details.owned) setError(t('deepLink.notOwned'));
          else if (!toLoginService(details.category))
            setError(t('deepLink.unsupported', { service: details.categoryTitle }));
          else setPending(details);
        })
        .catch(() => setError(t('deepLink.notFound')))
        .finally(() => setLoading(false));
    });
    return off;
  }, [t]);

  const close = () => {
    setPending(null);
    setError(null);
    setChoosingMethod(false);
    setChoosingProxy(false);
    setMethod(null);
  };

  const confirm = () => {
    if (!pending) return;
    const service = toLoginService(pending.category);
    if (!service) return;
    const methods = loginMethodsFor(service);
    const only = methods[0];
    if (methods.length <= 1 && only) {
      proceedWithMethod(only);
      return;
    }
    const saved = pending.category ? preferredLoginMethod[pending.category] : undefined;
    if (saved && methods.includes(saved)) {
      proceedWithMethod(saved);
      return;
    }
    setChoosingMethod(true);
  };

  const chooseMethod = (m: LoginMethod, remember: boolean) => {
    setChoosingMethod(false);
    if (remember && pending?.category) {
      void window.launcher.settings
        .set({ preferredLoginMethod: { ...preferredLoginMethod, [pending.category]: m } })
        .then((next) => useSettings.getState().set(next.settings));
    }
    proceedWithMethod(m);
  };

  const proceedWithMethod = (m: LoginMethod) => {
    if (!pending) return;
    setMethod(m);
    const nativeNoProxy = toLoginService(pending.category) === 'steam' && m === 'native';
    const canProxy =
      proxyEnabled &&
      proxies.length > 0 &&
      pending.category !== null &&
      proxyServices.includes(pending.category) &&
      !nativeNoProxy;
    if (canProxy) setChoosingProxy(true);
    else startLogin(m, null, null);
  };

  const startLogin = (m: LoginMethod, proxyId: string | null, proxyTest: ProxyTest | null) => {
    if (!pending) return;
    const service = toLoginService(pending.category);
    if (!service) return;
    const sess = useLoginSession.getState();
    const acc = pending;
    setPending(null);
    setChoosingProxy(false);
    setMethod(null);
    sess.start(acc.itemId, acc.title, service, m);
    window.launcher.accounts
      .login(acc.itemId, m, proxyId, proxyTest)
      .then((res) => {
        if (!res.ok) sess.fail(res.message ?? t('inventory.card.loginFailedFallback'));
      })
      .catch((err) =>
        sess.fail(err instanceof Error ? err.message : t('inventory.card.callError')),
      );
  };

  if (error) {
    return (
      <Modal
        title={t('deepLink.title')}
        size="sm"
        closable
        onClose={close}
        footer={
          <>
            <ModalSpacer />
            <Button variant="ghost" size="sm" onClick={close}>
              {t('deepLink.close')}
            </Button>
          </>
        }
      >
        <ModalStatus tone="bad" title={error} />
      </Modal>
    );
  }

  if (loading) {
    return (
      <Modal title={t('deepLink.title')} size="sm" closable onClose={close}>
        <ModalStatus tone="busy" title={t('deepLink.loading')} />
      </Modal>
    );
  }

  if (!pending) return null;

  const service = toLoginService(pending.category);

  if (choosingMethod && service) {
    return (
      <LoginMethodModal
        methods={loginMethodsFor(service)}
        onChoose={chooseMethod}
        onCancel={() => setChoosingMethod(false)}
      />
    );
  }

  if (choosingProxy && method) {
    return (
      <ProxyChoiceModal
        proxies={proxies}
        // A deep link into a pinned account asks nothing and dials the pin — the same behaviour the card has.
        autoTestId={
          pinnedProxyFor(
            { proxyEnabled, proxies, proxyServices, accountProxies },
            pending.itemId,
            pending.category,
          )?.id ?? null
        }
        onChoose={(id, test) => startLogin(method, id, test)}
        onCancel={() => setChoosingProxy(false)}
      />
    );
  }

  const warranty = service === 'steam' ? formatWarranty(pending.warrantyEndsAt, t) : null;

  return (
    <Modal
      title={t('deepLink.title')}
      size="sm"
      closable
      onClose={close}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={close}>
            {t('deepLink.cancel')}
          </Button>
          <Button variant="accent" size="sm" onClick={confirm}>
            {t('deepLink.confirm')}
          </Button>
        </>
      }
    >
      <ModalHint>{t('deepLink.body', { title: pending.title })}</ModalHint>
      {/* Ссылка приходит извне, и гарантия — единственное. */}
      {warranty && <ModalWarn>{t('inventory.card.warrantyWarnBody', { warranty })}</ModalWarn>}
    </Modal>
  );
};

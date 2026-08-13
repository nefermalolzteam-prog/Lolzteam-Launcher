import type { LocalePreference } from '@shared-types';
import { SUPPORTED_SERVICE_IDS, serviceLabel } from '@shared-types';
import { Check, Globe, KeyRound, Languages, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import backgroundUrl from '~/assets/background.svg';
import logoUrl from '~/assets/logolzt.svg';
import { LOCALE_FLAG } from '~/lib/flags';
import { serviceLogo } from '~/lib/serviceLogos';
import { useDismiss } from '~/lib/useDismiss';
import { Button } from '~/widgets/Button/Button';
import { Flag } from '~/widgets/Flag/Flag';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { EnterIcon } from '~/widgets/icons/Icons';
import { AppProxyModal } from './AppProxyModal';
import s from './LoginScreen.module.scss';
import { TokenLoginModal } from './TokenLoginModal';

const LOCALE_OPTIONS: readonly LocalePreference[] = ['ru', 'en'] as const;

/** Во что здесь можно войти — с логотипами, под описанием. */
const SERVICE_CHIPS = SUPPORTED_SERVICE_IDS.map((id) => ({
  id,
  label: serviceLabel(id),
  logo: serviceLogo(id),
}));

type NetState = { kind: 'checking' } | { kind: 'online'; ms: number } | { kind: 'offline' };

export const LoginScreen = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'browser' | null>(null);
  const [version, setVersion] = useState('');
  const [locale, setLocale] = useState<LocalePreference>('ru');
  const [langOpen, setLangOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [net, setNet] = useState<NetState>({ kind: 'checking' });
  const langRef = useDismiss<HTMLDivElement>(langOpen, () => setLangOpen(false));

  const checkNetwork = useCallback(async () => {
    setNet({ kind: 'checking' });
    const res = await window.launcher.app.pingApi();
    setNet(res.online ? { kind: 'online', ms: res.ms } : { kind: 'offline' });
  }, []);

  useEffect(() => {
    window.launcher.app.getVersion().then(setVersion);
    window.launcher.settings.get().then((next) => setLocale(next.settings.locale));
    const off = window.launcher.settings.onChanged((next) => setLocale(next.settings.locale));
    void checkNetwork();
    return off;
  }, [checkNetwork]);

  const handleBrowser = async () => {
    setBusy('browser');
    try {
      await window.launcher.auth.openBrowser();
    } finally {
      setBusy(null);
    }
  };

  const pickLocale = async (next: LocalePreference) => {
    setLangOpen(false);
    const res = await window.launcher.settings.set({ locale: next });
    setLocale(res.settings.locale);
  };

  return (
    <>
      <div className={s.loginContainer}>
        <div
          className={s.background}
          aria-hidden="true"
          style={{ '--login-bg': `url(${backgroundUrl})` } as React.CSSProperties}
        />

        <div
          className={`${s.netStatus} ${
            net.kind === 'online'
              ? s.netOnline
              : net.kind === 'offline'
                ? s.netOffline
                : s.netChecking
          }`}
          role="status"
        >
          {net.kind === 'checking' && (
            <>
              <Loader2 size={14} className={s.netSpin} />
              <span>{t('login.network.checking')}</span>
            </>
          )}
          {net.kind === 'online' && (
            <>
              <Wifi size={14} />
              <span>{t('login.network.online', { ms: net.ms })}</span>
            </>
          )}
          {net.kind === 'offline' && (
            <>
              <WifiOff size={14} />
              <span>{t('login.network.offline')}</span>
              <button type="button" className={s.netRetry} onClick={checkNetwork}>
                {t('login.network.retry')}
              </button>
            </>
          )}
        </div>

        <div className={s.loginBlock}>
          <img className={s.logo} src={logoUrl} alt="Lolzteam" />
          <div className={s.text}>
            <span className={s.title}>{t('login.title')}</span>
            <span className={s.description}>{t('login.lede')}</span>
          </div>
          <ul className={s.services} aria-label={t('login.services')}>
            {SERVICE_CHIPS.map((svc) => (
              <li key={svc.id} className={s.service}>
                {/* Логотип — украшение при своей же подписи: озвучивать «Steam Steam» скринридеру незачем. */}
                {svc.logo && <img className={s.serviceLogo} src={svc.logo} alt="" aria-hidden />}
                <span>{svc.label}</span>
              </li>
            ))}
          </ul>
          <div className={s.actions}>
            <Tooltip label={t('login.openBrowserTooltip')} placement="bottom">
              <Button
                variant="accent"
                size="lg"
                shape="pill"
                icon={EnterIcon}
                className={s.button}
                busy={busy === 'browser'}
                disabled={busy !== null || net.kind !== 'online'}
                onClick={handleBrowser}
              >
                {busy === 'browser' ? t('login.busyBrowser') : t('login.openBrowser')}
              </Button>
            </Tooltip>
            <Tooltip label={t('login.token.tooltip')} placement="bottom">
              <Button
                iconOnly
                icon={KeyRound}
                label={t('login.token.title')}
                variant="neutral"
                size="lg"
                shape="pill"
                onClick={() => setTokenOpen(true)}
              />
            </Tooltip>
            <Tooltip label={t('settings.proxy.appLabel')} placement="bottom">
              <Button
                iconOnly
                icon={Globe}
                label={t('settings.proxy.appLabel')}
                variant="neutral"
                size="lg"
                shape="pill"
                onClick={() => setProxyOpen(true)}
              />
            </Tooltip>
            <div className={s.langWrap} ref={langRef}>
              <Tooltip label={t('login.language')} placement="bottom" disabled={langOpen}>
                <Button
                  iconOnly
                  icon={Languages}
                  label={t('login.language')}
                  variant="neutral"
                  size="lg"
                  shape="pill"
                  aria-haspopup="menu"
                  aria-expanded={langOpen}
                  onClick={() => setLangOpen((v) => !v)}
                />
              </Tooltip>
              {langOpen && (
                <div className={s.langMenu} role="menu">
                  {LOCALE_OPTIONS.map((opt) => {
                    const active = locale === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={`${s.langOption} ${active ? s.langOptionActive : ''}`}
                        onClick={() => pickLocale(opt)}
                      >
                        <span className={s.langOptionMain}>
                          <Flag code={LOCALE_FLAG[opt]} className={s.langFlag} />
                          <span>{t(`settings.language.${opt}`)}</span>
                        </span>
                        {active && <Check size={16} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {version && <span className={s.version}>v{version}</span>}
      </div>

      {proxyOpen && <AppProxyModal onClose={() => setProxyOpen(false)} onChanged={checkNetwork} />}
      {tokenOpen && <TokenLoginModal onClose={() => setTokenOpen(false)} />}
    </>
  );
};

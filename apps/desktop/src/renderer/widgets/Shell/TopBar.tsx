import type { AuthSession, LocalePreference, MarketCurrency } from '@shared-types';
import DOMPurify from 'dompurify';
import { ChevronDown, Coins, Languages, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import logoUrl from '~/assets/logolzt.svg';
import { InventoryToolbar } from '~/features/inventory/InventoryToolbar';
import { CurrencyModal } from '~/features/profile/CurrencyModal';
import { LanguageModal } from '~/features/profile/LanguageModal';
import { CURRENCY_FLAG, LOCALE_FLAG } from '~/lib/flags';
import { useDismiss } from '~/lib/useDismiss';
import { useSettings } from '~/stores/settings';
import { useView } from '~/stores/view';
import { ChangelogModal } from '~/widgets/Changelog/ChangelogModal';
import { Flag } from '~/widgets/Flag/Flag';
import { Menu } from '~/widgets/Menu/Menu';
import { MenuItem } from '~/widgets/Menu/MenuItem';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { CogIcon, ExitIcon } from '~/widgets/icons/Icons';
import { NotificationBell } from './NotificationBell';
import { ProxyPingPill } from './ProxyPingPill';
import s from './TopBar.module.scss';

interface TopBarProps {
  session: AuthSession | null;
}

const formatBalance = (balance: number | null, currency: string | null, locale: string) => {
  if (balance === null) return null;
  const intlLocale = locale === 'ru' ? 'ru-RU' : 'en-US';
  if (currency) {
    try {
      return new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(balance);
    } catch {}
  }
  const formatted = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 }).format(balance);
  return `${formatted} ${currency ?? ''}`.trim();
};

export const TopBar = ({ session }: TopBarProps) => {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const setView = useView((st) => st.setView);
  const view = useView((st) => st.view);
  const locale: LocalePreference = useSettings((st) => st.settings?.locale ?? 'ru');
  const curCode = session?.currency?.toLowerCase();
  const currencyFlag =
    curCode && curCode in CURRENCY_FLAG ? CURRENCY_FLAG[curCode as MarketCurrency] : undefined;
  const profileRef = useDismiss<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  useEffect(() => {
    window.launcher.app.getVersion().then(setVersion);
  }, []);

  const balance = session ? formatBalance(session.balance, session.currency, i18n.language) : null;

  return (
    <header className={s.headerBar}>
      <div className={s.headerTop}>
        <div className={s.logoBlock}>
          <button
            type="button"
            className={s.logoButton}
            onClick={() => setView('inventory')}
            aria-label={t('topbar.title')}
          >
            <img className={s.logo} src={logoUrl} aria-hidden alt="Lolzteam" />
          </button>
          <div className={s.logoStatus}>
            <ProxyPingPill />
            {version && (
              <Tooltip label={t('changelog.title')} placement="bottom">
                <button type="button" className={s.version} onClick={() => setChangelogOpen(true)}>
                  v{version}
                </button>
              </Tooltip>
            )}
          </div>
        </div>
        {session && (
          <div className={s.headerRight}>
            <NotificationBell />
            <div className={s.profile} ref={profileRef}>
              <button
                type="button"
                className={s.profileTrigger}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                {session.avatarUrl ? (
                  <img className={s.avatar} src={session.avatarUrl} alt="" />
                ) : (
                  <div className={s.avatarFallback}>
                    <User size={16} />
                  </div>
                )}
                <div className={s.profileText}>
                  {session.usernameHtml ? (
                    <span
                      className={s.username}
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: API-supplied styled username, sanitized to inert markup below
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(session.usernameHtml, {
                          ALLOWED_TAGS: ['span', 'b', 'i', 'em', 'strong'],
                          ALLOWED_ATTR: ['class', 'style'],
                        }),
                      }}
                    />
                  ) : (
                    <span className={s.username}>{session.username}</span>
                  )}
                  {balance && <span className={s.balance}>{balance}</span>}
                </div>
                <ChevronDown
                  size={16}
                  className={`${s.chevron} ${menuOpen ? s.chevronOpen : ''}`}
                />
              </button>

              <Menu open={menuOpen} onClose={() => setMenuOpen(false)} label={t('topbar.title')}>
                <MenuItem icon={<CogIcon size={16} />} onSelect={() => setView('settings')}>
                  {t('sidebar.settings')}
                </MenuItem>
                <MenuItem
                  icon={
                    LOCALE_FLAG[locale] ? (
                      <Flag code={LOCALE_FLAG[locale]} />
                    ) : (
                      <Languages size={16} />
                    )
                  }
                  onSelect={() => setLangOpen(true)}
                >
                  {t('topbar.language')}
                </MenuItem>
                <MenuItem
                  icon={currencyFlag ? <Flag code={currencyFlag} /> : <Coins size={16} />}
                  onSelect={() => setCurrencyOpen(true)}
                >
                  {t('topbar.currency')}
                </MenuItem>
                <MenuItem
                  icon={<ExitIcon size={16} />}
                  onSelect={() => window.launcher.auth.logout()}
                >
                  {t('topbar.logout')}
                </MenuItem>
              </Menu>
            </div>
          </div>
        )}
      </div>

      {session && (
        <div
          className={`${s.headerToolbar} ${view === 'inventory' ? s.headerToolbarOpen : ''}`}
          // Kept mounted on every view so the header can collapse smoothly.
          inert={view !== 'inventory'}
        >
          <div className={s.headerToolbarInner}>
            <InventoryToolbar />
          </div>
        </div>
      )}

      {langOpen && <LanguageModal onClose={() => setLangOpen(false)} />}
      {currencyOpen && <CurrencyModal onClose={() => setCurrencyOpen(false)} />}

      {changelogOpen && (
        <ChangelogModal currentVersion={version} onClose={() => setChangelogOpen(false)} />
      )}
    </header>
  );
};

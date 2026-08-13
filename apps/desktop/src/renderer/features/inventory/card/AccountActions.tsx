import type { AccountSummary } from '@shared-types';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SdaCodeIcon } from '~/features/guard/SdaIcon';
import { proxyName } from '~/lib/proxy';
import { Button } from '~/widgets/Button/Button';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import { NoteIcon } from '~/widgets/icons/Icons';
import s from '../AccountCard.module.scss';
import { AccountMenu } from './AccountMenu';
import type { AccountControls } from './controls';
import type { AccountFacts } from './facts';

/** The login button and everything standing next to it. */
export const AccountActions = ({
  facts,
  controls,
  compact,
  onEdit,
  onDelete,
}: {
  facts: AccountFacts;
  controls: AccountControls;
  compact: boolean;
  onEdit?: (item: AccountSummary) => void;
  onDelete?: (item: AccountSummary) => void;
}) => {
  const { t } = useTranslation();
  const { item, canLogin, isInvalid, hasGuard } = facts;
  const { busy, cooldownLeft, pinnedProxy } = controls;
  const iconClass = `${s.actionIcon} ${compact ? s.actionCompact : ''}`;

  // Кнопка одна, а мест у неё два, и зависит это от формы.
  const loginButton = (
    <Tooltip
      label={
        canLogin
          ? isInvalid
            ? t('inventory.card.loginInvalidTooltip')
            : t('inventory.card.loginTooltip')
          : t('inventory.card.unsupportedTooltip')
      }
    >
      <Button
        variant={isInvalid ? 'neutral' : 'accent'}
        size={compact ? 'md' : 'lg'}
        shape="pill"
        busy={busy}
        disabled={!canLogin || cooldownLeft > 0}
        onClick={controls.startLogin}
      >
        {busy
          ? t('inventory.card.busy')
          : cooldownLeft > 0
            ? t('inventory.card.rateLimited', { sec: cooldownLeft })
            : t('inventory.card.login')}
      </Button>
    </Tooltip>
  );

  return (
    <>
      {!compact && loginButton}
      <div className={s.iconActions}>
        {/* A note is worth nothing if you have to remember which accounts have one. */}
        {item.note && (
          <Tooltip label={item.note}>
            <button
              type="button"
              className={`${iconClass} ${s.actionIconOn}`}
              onClick={controls.openNote}
              aria-label={t('inventory.card.note.menuEdit')}
            >
              <NoteIcon />
            </button>
          </Tooltip>
        )}
        {/* A pinned account says so where it is looked at, not only in the menu it was pinned from. */}
        {pinnedProxy && (
          <Tooltip
            label={t('inventory.card.proxy.pinnedTooltip', { name: proxyName(pinnedProxy) })}
          >
            <button
              type="button"
              className={`${iconClass} ${s.actionIconOn}`}
              onClick={controls.openProxyPin}
              aria-label={t('inventory.card.proxy.pinnedTooltip', {
                name: proxyName(pinnedProxy),
              })}
            >
              <Globe />
            </button>
          </Tooltip>
        )}
        {/* The one menu entry that got its own button. */}
        {hasGuard && (
          <Tooltip label={t('inventory.card.sdaMenu')}>
            <button
              type="button"
              className={iconClass}
              onClick={controls.openSda}
              aria-label={t('inventory.card.sdaMenu')}
            >
              <SdaCodeIcon />
            </button>
          </Tooltip>
        )}
        {compact && loginButton}
        <div className={s.menuWrap} ref={controls.menuRef}>
          <Tooltip label={t('inventory.card.menuTooltip')}>
            <button
              type="button"
              className={iconClass}
              onClick={controls.toggleMenu}
              aria-haspopup="menu"
              aria-expanded={controls.menuOpen}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M12 13C12.5523 13 13 12.5523 13 12C13 11.4477 12.5523 11 12 11C11.4477 11 11 11.4477 11 12C11 12.5523 11.4477 13 12 13Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M19 13C19.5523 13 20 12.5523 20 12C20 11.4477 19.5523 11 19 11C18.4477 11 18 11.4477 18 12C18 12.5523 18.4477 13 19 13Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M5 13C5.55228 13 6 12.5523 6 12C6 11.4477 5.55228 11 5 11C4.44772 11 4 11.4477 4 12C4 12.5523 4.44772 13 5 13Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </Tooltip>
          <AccountMenu
            facts={facts}
            controls={controls}
            compact={compact}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </div>
    </>
  );
};

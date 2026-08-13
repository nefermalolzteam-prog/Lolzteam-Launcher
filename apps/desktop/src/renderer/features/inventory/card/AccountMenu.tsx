import type { AccountSummary } from '@shared-types';
import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MASS_ACTIONS } from '~/features/base/actions';
import { massServiceOf } from '~/features/base/selection';
import { SdaIcon } from '~/features/guard/SdaIcon';
import { proxyName } from '~/lib/proxy';
import { Menu } from '~/widgets/Menu/Menu';
import { MenuItem } from '~/widgets/Menu/MenuItem';
import {
  BrowserIcon,
  DatabaseIcon,
  FolderIcon,
  MarketIcon,
  MoveIcon,
  NoteIcon,
  PencilIcon,
  PinIcon,
  RefreshIcon,
  TagIcon,
  TrashIcon,
} from '~/widgets/icons/Icons';
import type { AccountControls } from './controls';
import type { AccountFacts } from './facts';

/** Everything the «⋯» button opens. */
export const AccountMenu = ({
  facts,
  controls,
  compact,
  onEdit,
  onDelete,
}: {
  facts: AccountFacts;
  controls: AccountControls;
  /** A row rather than a card: the menu prefers to open downwards. */
  compact: boolean;
  onEdit?: (item: AccountSummary) => void;
  onDelete?: (item: AccountSummary) => void;
}) => {
  const { t } = useTranslation();
  const { item, service, canLogin, llmUnsupported, hasGuard, checkable, isLocal, copyable } = facts;
  const { busy, checking, pinnedProxy, proxyForThis } = controls;

  return (
    // A row is short, so its menu opens downwards; a card is tall and its button sits at the bottom.
    <Menu
      open={controls.menuOpen}
      onClose={controls.closeMenu}
      placement={compact ? 'bottom-end' : 'top-end'}
      label={t('inventory.card.menuTooltip')}
    >
      {service === 'steam' && (
        <MenuItem
          icon={<BrowserIcon size={16} />}
          onSelect={controls.startSteamWebLogin}
          disabled={!canLogin || busy}
        >
          {t('inventory.card.loginViaBrowser')}
        </MenuItem>
      )}
      {service === 'llm' && !llmUnsupported && (
        <MenuItem
          icon={<BrowserIcon size={16} />}
          onSelect={controls.startLlmWebLogin}
          disabled={!canLogin || busy}
        >
          {t('inventory.card.loginViaBrowser')}
        </MenuItem>
      )}
      {/* Offered on exactly the accounts a proxy would be offered to at login — the same three gates. */}
      {proxyForThis && (
        <MenuItem icon={<PinIcon size={16} />} onSelect={controls.openProxyPin}>
          {pinnedProxy
            ? t('inventory.card.proxy.pinMenuChange', { name: proxyName(pinnedProxy) })
            : t('inventory.card.proxy.pinMenu')}
        </MenuItem>
      )}
      {item.hasEmailLogin && (
        <MenuItem icon={<Mail size={16} />} onSelect={controls.openEmail}>
          {t('inventory.card.emailMenu')}
        </MenuItem>
      )}
      {hasGuard && (
        <MenuItem icon={<SdaIcon />} onSelect={controls.openSda}>
          {t('inventory.card.sdaMenu')}
        </MenuItem>
      )}
      {/* The mass operations, aimed at one account, read off the same table the panel draws its buttons from. */}
      {checkable &&
        MASS_ACTIONS.filter(
          (action) => !action.soon && action.services.includes(massServiceOf(item)),
        ).map((action) => {
          const Icon = action.icon;
          return (
            <MenuItem
              key={action.id}
              icon={<Icon size={16} />}
              onSelect={() => controls.askMass(action.id)}
            >
              {t(`base.actions.${action.id}`)}
            </MenuItem>
          );
        })}
      {isLocal ? (
        <>
          <MenuItem icon={<FolderIcon size={16} />} onSelect={controls.openFolder}>
            {t('inventory.card.openFolder')}
          </MenuItem>
          <MenuItem icon={<TagIcon size={16} />} onSelect={controls.openLabels}>
            {t('inventory.card.localLabels.menu')}
          </MenuItem>
          <MenuItem icon={<MoveIcon size={16} />} onSelect={controls.openMoveFolder}>
            {t('inventory.card.moveFolder.menu')}
          </MenuItem>
          {onEdit && (
            <MenuItem icon={<PencilIcon size={16} />} onSelect={() => onEdit(item)}>
              {t('inventory.card.editLocal')}
            </MenuItem>
          )}
          {onDelete && (
            <MenuItem danger icon={<TrashIcon size={16} />} onSelect={() => onDelete(item)}>
              {t('inventory.card.deleteLocal')}
            </MenuItem>
          )}
        </>
      ) : (
        <>
          <MenuItem
            icon={<RefreshIcon size={16} />}
            onSelect={controls.runCheck}
            disabled={checking}
          >
            {t('inventory.card.checkValidity')}
          </MenuItem>
          <MenuItem icon={<TagIcon size={16} />} onSelect={controls.openLabels}>
            {t('inventory.card.labelsMenu')}
          </MenuItem>
          {/* Market accounts only, and not for want of a place to put it: the note lives on the item. */}
          <MenuItem icon={<NoteIcon size={16} />} onSelect={controls.openNote}>
            {t(item.note ? 'inventory.card.note.menuEdit' : 'inventory.card.note.menu')}
          </MenuItem>
          {/* The market's own mark rather than a generic «ссылка наружу». */}
          <MenuItem icon={<MarketIcon size={16} />} onSelect={controls.openOnMarket}>
            {t('inventory.card.openOnMarket')}
          </MenuItem>
          {/* Last, and only while there is nothing to point at: once the copy exists the card says so with a badge instead. */}
          {copyable && (
            <MenuItem icon={<DatabaseIcon size={16} />} onSelect={controls.copyToBase}>
              {t('inventory.card.copyToBase.menu')}
            </MenuItem>
          )}
        </>
      )}
    </Menu>
  );
};

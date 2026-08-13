import type {
  TelegramPrivacyKey,
  TelegramPrivacyRequest,
  TelegramPrivacyValue,
} from '@shared-types';
import { TELEGRAM_PRIVACY_KEYS, TELEGRAM_PRIVACY_PREMIUM_ONLY } from '@shared-types';
import { ShieldHalf } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalChip,
  ModalChips,
  ModalError,
  ModalGroup,
  ModalHint,
  ModalSection,
  ModalSpacer,
  ModalWarn,
} from '~/widgets/Modal/ModalKit';
import { ProxySpreadRow, useProxySpread } from './ProxySpreadRow';

interface PrivacyModalProps {
  count: number;
  /** Set when main refused the run — `busy`, or nothing chosen. */
  error: string | null;
  onCancel: () => void;
  onStart: (req: Omit<TelegramPrivacyRequest, 'accountIds'>) => void;
}

/** Our fourth answer, which never reaches Telegram: the key is simply skipped. */
type Choice = TelegramPrivacyValue | 'keep';

const CHOICES = ['keep', 'nobody', 'contacts', 'everybody'] as const satisfies readonly Choice[];

type Selection = Readonly<Record<TelegramPrivacyKey, Choice>>;

const KEEP_ALL: Selection = {
  lastSeen: 'keep',
  profilePhoto: 'keep',
  phone: 'keep',
  forwards: 'keep',
  calls: 'keep',
  groups: 'keep',
  voices: 'keep',
  bio: 'keep',
  birthday: 'keep',
};

/** «Закрыть всё» — what an account is expected to look like after a sale. */
const PRESET_PRIVATE: Selection = {
  lastSeen: 'nobody',
  profilePhoto: 'contacts',
  phone: 'nobody',
  forwards: 'nobody',
  calls: 'nobody',
  groups: 'contacts',
  voices: 'nobody',
  bio: 'contacts',
  birthday: 'contacts',
};

const PRESET_OPEN: Selection = {
  lastSeen: 'everybody',
  profilePhoto: 'everybody',
  phone: 'everybody',
  forwards: 'everybody',
  calls: 'everybody',
  groups: 'everybody',
  voices: 'everybody',
  bio: 'everybody',
  birthday: 'everybody',
};

const PRESETS = [
  { id: 'keep', selection: KEEP_ALL },
  { id: 'private', selection: PRESET_PRIVATE },
  { id: 'open', selection: PRESET_OPEN },
] as const;

export const PrivacyModal = ({ count, error, onCancel, onStart }: PrivacyModalProps) => {
  const { t } = useTranslation();

  const [selection, setSelection] = useState<Selection>(KEEP_ALL);
  const [busy, setBusy] = useState(false);
  const proxy = useProxySpread('telegram');

  const pick = (key: TelegramPrivacyKey, choice: Choice): void =>
    setSelection((prev) => ({ ...prev, [key]: choice }));

  const rules: Partial<Record<TelegramPrivacyKey, TelegramPrivacyValue>> = {};
  for (const key of TELEGRAM_PRIVACY_KEYS) {
    const choice = selection[key];
    if (choice !== 'keep') rules[key] = choice;
  }
  const chosen = Object.keys(rules).length;
  const premiumChosen = TELEGRAM_PRIVACY_PREMIUM_ONLY.some((key) => selection[key] !== 'keep');

  const start = (): void => {
    if (busy || chosen === 0) return;
    setBusy(true);
    onStart({ rules, proxyIds: proxy.proxyIds });
  };

  useEffect(() => {
    if (error) setBusy(false);
  }, [error]);

  return (
    <Modal
      title={t('base.privacy.title')}
      closable
      onClose={onCancel}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('base.check.cancel')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            icon={ShieldHalf}
            busy={busy}
            disabled={chosen === 0}
            title={chosen === 0 ? t('base.privacy.nothingToDo') : undefined}
            onClick={start}
          >
            {t('base.privacy.start', { count: chosen })}
          </Button>
        </>
      }
    >
      <ModalError>{error}</ModalError>
      <ModalHint>{t('base.privacy.lead', { count })}</ModalHint>

      <ModalGroup>{t('base.privacy.presets')}</ModalGroup>
      {/* Без подсветки: пресет не состояние, а действие — он заполняет девять рядов ниже и тут же перестаёт что-либо значить. */}
      <ModalChips>
        {PRESETS.map(({ id, selection: preset }) => (
          <ModalChip
            key={id}
            label={t(`base.privacy.preset.${id}`)}
            onClick={() => setSelection(preset)}
          />
        ))}
      </ModalChips>

      {TELEGRAM_PRIVACY_KEYS.map((key) => (
        <ModalSection key={key}>
          <ModalGroup>{t(`base.privacy.key.${key}`)}</ModalGroup>
          <ModalChips>
            {CHOICES.map((choice) => (
              <ModalChip
                key={choice}
                label={t(`base.privacy.value.${choice}`)}
                selected={selection[key] === choice}
                onClick={() => pick(key, choice)}
              />
            ))}
          </ModalChips>
        </ModalSection>
      ))}

      {/* Said before the run rather than reported after it: a free account will refuse this one. */}
      {premiumChosen && <ModalWarn>{t('base.privacy.premiumWarn')}</ModalWarn>}

      <ProxySpreadRow
        state={proxy}
        hint={t('base.check.spreadHint')}
        noProxy={t('base.check.noProxy')}
      />
    </Modal>
  );
};

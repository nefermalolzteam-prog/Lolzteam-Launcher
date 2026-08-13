import { LOLZ_CONFIG } from '@shared-ipc';
import type { AuthTokenSubmitResult } from '@shared-ipc';
import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalError,
  ModalField,
  ModalHint,
  ModalIconButton,
  ModalInput,
  ModalSpacer,
} from '~/widgets/Modal/ModalKit';
import s from './TokenLoginModal.module.scss';

/** Where the forum hands out personal API keys. */
const TOKEN_PAGE = `${LOLZ_CONFIG.webUrl}/account/api`;

/** Права, без которых токен здесь бесполезен. */
const REQUIRED_SCOPES = LOLZ_CONFIG.oauthScopes.split(' ').filter((sc) => sc !== '');

interface TokenLoginModalProps {
  onClose: () => void;
}

/** The way in when the browser flow cannot be used. */
export const TokenLoginModal = ({ onClose }: TokenLoginModalProps) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || token.trim() === '') return;
    setBusy(true);
    setError(null);
    let res: AuthTokenSubmitResult;
    try {
      res = await window.launcher.auth.submitToken(token);
    } catch {
      // The handler itself threw — which is not «the token is bad», so it must not be reported as such.
      res = { ok: false, reason: 'offline' };
    } finally {
      setBusy(false);
    }
    if (res.ok) {
      setToken('');
      onClose();
      return;
    }
    setError(t(`login.token.error.${res.reason}`));
  };

  return (
    <Modal
      title={t('login.token.title')}
      closable
      onClose={onClose}
      footer={
        <>
          <ModalSpacer />
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={busy}
            disabled={token.trim() === ''}
            onClick={() => void submit()}
          >
            {busy ? t('login.token.checking') : t('login.token.submit')}
          </Button>
        </>
      }
    >
      <ModalHint>{t('login.token.hint')}</ModalHint>

      {/* Права — списком, а не строкой через запятую: галочек на странице выдачи ровно столько. */}
      <div className={s.scopesBlock}>
        <p className={s.scopesTitle}>{t('login.token.scopesTitle')}</p>
        <ul className={s.scopes}>
          {REQUIRED_SCOPES.map((scope) => (
            <li key={scope} className={s.scope}>
              <code className={s.scopeName}>{scope}</code>
              <span className={s.scopeWhy}>
                {t(`login.token.scope.${scope}`, { defaultValue: '' })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Глаз — внутри поля, а не рядом: он показывает то самое. */}
      <ModalField label={t('login.token.label')} note={t('login.token.note')}>
        <span className={s.field}>
          <ModalInput
            className={s.input}
            type={reveal ? 'text' : 'password'}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
            placeholder={t('login.token.placeholder')}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <span className={s.reveal}>
            <ModalIconButton
              icon={reveal ? EyeOff : Eye}
              label={t(reveal ? 'login.token.hide' : 'login.token.show')}
              onClick={() => setReveal((v) => !v)}
            />
          </span>
        </span>
      </ModalField>

      <ModalError>{error}</ModalError>

      {/* Не призрак: это единственный выход из тупика «токена ещё нет». */}
      <span className={s.whereRow}>
        <Button
          variant="neutral"
          icon={ExternalLink}
          onClick={() => void window.launcher.app.openExternal(TOKEN_PAGE)}
        >
          {t('login.token.where')}
        </Button>
      </span>
    </Modal>
  );
};

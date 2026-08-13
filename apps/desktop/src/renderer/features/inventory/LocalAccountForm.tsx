import type {
  LocalAccountEdit,
  LocalAccountInput,
  LocalServiceId,
  TelegramIdentified,
} from '@shared-types';
import { LOCAL_SERVICE_IDS, serviceLabel } from '@shared-types';
import { FileSearch, FolderSearch, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import {
  ModalCheck,
  ModalChecks,
  ModalChip,
  ModalChips,
  ModalError,
  ModalField,
  ModalGroup,
  ModalInput,
  ModalTextarea,
} from '~/widgets/Modal/ModalKit';
import s from './LocalAccountForm.module.scss';
import { localErrorText } from './localErrors';

const DC_IDS = [1, 2, 3, 4, 5] as const;

/** A raw key, with or without its `:<dc>` suffix — no round trip needed for it. */
const HEX_KEY = /^[0-9a-fA-F]{512}(:[1-5])?$/;

const fileName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export interface LocalAccountFormProps {
  /** `null` = create; otherwise the non-secret half of an existing record. */
  edit: LocalAccountEdit | null;
  /** Create mode: start on this service. */
  initialService?: LocalServiceId;
  /** Create mode: hide the picker when the service is not the form's to choose. */
  lockService?: boolean;
  cancelLabel?: string;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (input: LocalAccountInput) => Promise<{ ok: boolean; message?: string }>;
  /** Called after a successful submit — closes the modal, advances the page. */
  onDone: () => void;
  /** Offered when the picked folder holds more than one account: saving one at a time would be absurd. */
  onBulkImport?: (dir: string) => void;
}

export const LocalAccountForm = ({
  edit,
  initialService,
  lockService = false,
  cancelLabel,
  submitLabel,
  onCancel,
  onSubmit,
  onDone,
  onBulkImport,
}: LocalAccountFormProps) => {
  const { t } = useTranslation();
  // Changing the service of an existing record would mean replacing every field it has.
  const [service, setService] = useState<LocalServiceId>(
    edit?.service ?? initialService ?? 'steam',
  );
  const [label, setLabel] = useState(edit?.label ?? '');

  const [login, setLogin] = useState(edit?.service === 'steam' ? edit.login : '');
  const [password, setPassword] = useState('');
  const [guard, setGuard] = useState('');
  const [clearGuard, setClearGuard] = useState(false);

  const [authKey, setAuthKey] = useState('');
  const [dcId, setDcId] = useState(edit?.service === 'telegram' ? String(edit.dcId) : '2');
  const [phone, setPhone] = useState(edit?.service === 'telegram' ? (edit.phone ?? '') : '');
  const [userId, setUserId] = useState(
    edit?.service === 'telegram' && edit.userId !== null ? String(edit.userId) : '',
  );

  /** The container main recognised, if any: what `sessionToken` on save refers to. */
  const [detected, setDetected] = useState<TelegramIdentified | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [unknown, setUnknown] = useState(false);
  /** Path of the picked file or folder, shown instead of the pasted text. */
  const [source, setSource] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Whatever the container knows fills a blank field; typed values are left alone. */
  const applyIdentified = useCallback((info: TelegramIdentified) => {
    setDetected(info);
    setUnknown(false);
    setDcId(String(info.dcId));
    setPhone((v) => v.trim() || info.phone || '');
    setUserId((v) => v.trim() || (info.userId === null ? '' : String(info.userId)));
    setLabel((v) => v.trim() || info.title);
  }, []);

  const forget = useCallback(() => {
    setDetected(null);
    setUnknown(false);
  }, []);

  // Pasted text is identified as it settles.
  useEffect(() => {
    if (service !== 'telegram') return;
    const text = authKey.trim();
    if (!text || HEX_KEY.test(text.replace(/\s+/g, ''))) {
      forget();
      return;
    }
    let cancelled = false;
    setDetecting(true);
    const timer = setTimeout(() => {
      void window.launcher.telegram.identify({ text }).then((res) => {
        if (cancelled) return;
        setDetecting(false);
        if (res.ok) applyIdentified(res.identified);
        else {
          setDetected(null);
          setUnknown(true);
        }
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setDetecting(false);
    };
  }, [authKey, service, applyIdentified, forget]);

  const pick = async (mode: 'file' | 'dir') => {
    const title = t(
      mode === 'dir' ? 'inventory.local.pickDirTitle' : 'inventory.local.pickFileTitle',
    );
    const picked = await window.launcher.telegram.pickPath(mode, title);
    if (!picked.path) return;
    setAuthKey('');
    setSource(picked.path);
    setDetected(null);
    setUnknown(false);
    setDetecting(true);
    const res = await window.launcher.telegram.identify({ path: picked.path });
    setDetecting(false);
    if (res.ok) applyIdentified(res.identified);
    else setUnknown(true);
  };

  const hasStoredSecret =
    edit !== null && (edit.service === 'steam' ? edit.hasSharedSecret : edit.hasAuthKey);
  // Подтверждения закрыты не «навсегда», а до тех пор, пока в это поле не вставят весь maFile.
  const guardNote =
    edit?.service === 'steam' && edit.hasSharedSecret && !edit.hasIdentitySecret
      ? t('inventory.local.guardNoIdentity')
      : t('inventory.local.guardHint');
  // On update a blank secret keeps the stored one, so it is only required when there is nothing on file yet.
  const valid =
    service === 'steam'
      ? login.trim().length > 0 && (edit !== null || password.length > 0)
      : edit !== null || detected !== null || authKey.trim().length > 0;

  const buildInput = (): LocalAccountInput =>
    service === 'steam'
      ? { service: 'steam', label, login, password, guard, clearGuard }
      : {
          service: 'telegram',
          label,
          // A recognised container answers for the key; the text that produced it is a session string.
          authKey: detected ? '' : authKey,
          dcId,
          phone,
          userId,
          ...(detected ? { sessionToken: detected.token } : {}),
        };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await onSubmit(buildInput());
    if (res.ok) {
      onDone();
    } else {
      setError(localErrorText(t, res.message ?? 'unknown'));
      setBusy(false);
    }
  };

  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!lockService && (
        <>
          <ModalGroup>{t('inventory.local.service')}</ModalGroup>
          <ModalChips>
            {LOCAL_SERVICE_IDS.map((id) => (
              <ModalChip
                key={id}
                label={serviceLabel(id)}
                selected={service === id}
                disabled={edit !== null}
                onClick={() => setService(id)}
              />
            ))}
          </ModalChips>
        </>
      )}

      <ModalField label={t('inventory.local.label')}>
        <ModalInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('inventory.local.labelPlaceholder')}
          maxLength={64}
          spellCheck={false}
        />
      </ModalField>

      {service === 'steam' ? (
        <>
          <ModalField label={t('inventory.local.steamLogin')}>
            <ModalInput
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              // Форму открывают ровно ради этой пары полей — курсор в первом.
              autoFocus
            />
          </ModalField>
          <ModalField label={t('inventory.local.steamPassword')}>
            <ModalInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={edit ? t('inventory.local.keepSecret') : ''}
              autoComplete="off"
              spellCheck={false}
            />
          </ModalField>
          <ModalField label={t('inventory.local.steamGuard')} note={guardNote}>
            <ModalTextarea
              className={s.data}
              value={guard}
              onChange={(e) => setGuard(e.target.value)}
              // Подсказка о формате уже стоит под полем, поэтому здесь остаётся только то, чего под полем не скажешь.
              placeholder={hasStoredSecret ? t('inventory.local.keepSecret') : ''}
              rows={3}
              spellCheck={false}
              disabled={clearGuard}
            />
          </ModalField>
          {hasStoredSecret && (
            <ModalChecks>
              <ModalCheck checked={clearGuard} onChange={setClearGuard}>
                {t('inventory.local.clearGuard')}
              </ModalCheck>
            </ModalChecks>
          )}
        </>
      ) : (
        <>
          <ModalField label={t('inventory.local.session')} note={t('inventory.local.sessionHint')}>
            <ModalTextarea
              className={s.data}
              value={authKey}
              onChange={(e) => {
                setAuthKey(e.target.value);
                setSource(null);
              }}
              placeholder={edit ? t('inventory.local.keepSecret') : ''}
              rows={3}
              spellCheck={false}
              // Ключ сюда вставляют из буфера — поле и есть вся форма.
              autoFocus
            />
          </ModalField>

          {/* Two buttons, not one: Windows will not offer files and folders in the same dialog. */}
          <div className={s.pickRow}>
            <Button
              variant="neutral"
              size="sm"
              block
              icon={FileSearch}
              onClick={() => void pick('file')}
            >
              {t('inventory.local.pickFile')}
            </Button>
            <Button
              variant="neutral"
              size="sm"
              block
              icon={FolderSearch}
              onClick={() => void pick('dir')}
            >
              {t('inventory.local.pickDir')}
            </Button>
          </div>

          {source && <p className={s.source}>{fileName(source)}</p>}

          {/* Не `<ModalStatus/>`: тот — крупный итог на всё окно, ради которого его и открыли. */}
          {detecting && (
            <p className={s.status}>
              <Loader2 size={13} className={s.spin} />
              <span>{t('inventory.local.detecting')}</span>
            </p>
          )}
          {!detecting && detected && (
            <p className={`${s.status} ${s.statusOk}`}>
              {t('inventory.local.detected', {
                format: t(`telegram.formats.${detected.format}`),
              })}
            </p>
          )}
          {!detecting && unknown && (
            <p className={`${s.status} ${s.statusBad}`}>{t('inventory.local.notRecognised')}</p>
          )}

          {/* A folder with a whole base in it: one at a time is not the answer. */}
          {onBulkImport && detected && detected.more > 0 && detected.dir && (
            <div className={s.more}>
              <span>{t('inventory.local.moreInFolder', { count: detected.more })}</span>
              <Button variant="ghost" size="sm" onClick={() => onBulkImport(detected.dir ?? '')}>
                {t('inventory.local.importAll')}
              </Button>
            </div>
          )}

          <ModalGroup>{t('inventory.local.dcId')}</ModalGroup>
          <ModalChips>
            {DC_IDS.map((id) => (
              <ModalChip
                key={id}
                label={id}
                selected={dcId === String(id)}
                onClick={() => setDcId(String(id))}
              />
            ))}
          </ModalChips>

          <ModalField label={t('inventory.local.phone')}>
            <ModalInput
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+79991234567"
              spellCheck={false}
            />
          </ModalField>
          <ModalField label={t('inventory.local.userId')}>
            <ModalInput
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              inputMode="numeric"
              spellCheck={false}
            />
          </ModalField>
        </>
      )}

      <ModalError>{error}</ModalError>

      {/* Своя строка кнопок, а не футер каркаса: ту же форму рисует страница импорта, у которой футера нет вовсе. */}
      <div className={s.actions}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {cancelLabel ?? t('inventory.local.cancel')}
        </Button>
        <Button variant="accent" size="sm" type="submit" busy={busy} disabled={!valid}>
          {submitLabel ?? t('inventory.local.save')}
        </Button>
      </div>
    </form>
  );
};

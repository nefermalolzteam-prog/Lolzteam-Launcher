import type { MailLetter } from '@shared-types';
import DOMPurify from 'dompurify';
import {
  AtSign,
  Check,
  Copy,
  Eye,
  EyeOff,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMailTarget } from '~/stores/mailTarget';
import { useSettings } from '~/stores/settings';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from './MailView.module.scss';
import {
  type Credentials,
  type LetterFacts,
  countCodes,
  filterLetters,
  formatFullDate,
  formatShortDate,
  joinCredentials,
  letterFacts,
  splitCredentials,
  tidyPlainText,
} from './mailRules';

const LIMIT = 50;
const HISTORY_MAX = 8;
/** Сколько «Скопировано» держится на фишке кода. */
const COPIED_MS = 1200;

const openExternal = (url: string) => {
  if (/^https?:\/\//i.test(url)) void window.launcher.app.openExternal(url);
};

const onBodyClick = (e: MouseEvent<HTMLElement>) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (anchor?.href) {
    e.preventDefault();
    openExternal(anchor.href);
  }
};

const htmlToText = (html: string): string =>
  new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

/** Текст письма — единственное место в странице, где разворачивается HTML. */
const textOf = (letter: MailLetter): string =>
  letter.textPlain ?? (letter.textHtml ? htmlToText(letter.textHtml) : '');

const URL_RE = /(https?:\/\/[^\s]+)/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;
const isUrl = (str: string) => /^https?:\/\//i.test(str);

const PlainBody = ({ text }: { text: string }) => (
  <pre className={s.bodyText}>
    {text.split(URL_RE).map((part, i) => {
      if (!isUrl(part)) return part;
      const trail = part.match(TRAILING)?.[0] ?? '';
      const url = trail ? part.slice(0, -trail.length) : part;
      return (
        <span key={i}>
          <a
            className={s.link}
            href={url}
            onClick={(e) => {
              e.preventDefault();
              openExternal(url);
            }}
          >
            {url}
          </a>
          {trail}
        </span>
      );
    })}
  </pre>
);

const LetterBody = ({ letter }: { letter: MailLetter }) => {
  if (letter.textPlain) return <PlainBody text={tidyPlainText(letter.textPlain)} />;
  if (letter.textHtml) {
    return (
      <div
        className={s.bodyHtml}
        onClick={onBodyClick}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: third-party email HTML, sanitized to inert markup
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(letter.textHtml, {
            FORBID_TAGS: ['style', 'script', 'iframe', 'link', 'form', 'input'],
            FORBID_ATTR: ['style', 'onerror', 'onload'],
          }),
        }}
      />
    );
  }
  return null;
};

/** Страница почты. */
export const MailView = () => {
  const { t, i18n } = useTranslation();
  const history = useSettings((st) => st.settings?.mailHistory ?? []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [letters, setLetters] = useState<MailLetter[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyCodes, setOnlyCodes] = useState(false);

  // Разбор — один раз на загрузку, а не на каждый символ в поиске: развернуть HTML полусотни писем и поискать в них код.
  const facts = useMemo(
    () => (letters ?? []).map((letter) => letterFacts(letter, textOf(letter))),
    [letters],
  );
  const codeCount = useMemo(() => countCodes(facts), [facts]);
  const shown = useMemo(() => filterLetters(facts, query, onlyCodes), [facts, query, onlyCodes]);

  const pushHistory = async (entry: string) => {
    const cur = useSettings.getState().settings?.mailHistory ?? [];
    const next = [entry, ...cur.filter((e) => e !== entry)].slice(0, HISTORY_MAX);
    await window.launcher.settings.set({ mailHistory: next });
  };

  const removeHistory = async (entry: string) => {
    const cur = useSettings.getState().settings?.mailHistory ?? [];
    await window.launcher.settings.set({ mailHistory: cur.filter((e) => e !== entry) });
  };

  const run = async (creds: Credentials) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setOpenId(null);
    try {
      const res = await window.launcher.mail.getLetters({ ...creds, limit: LIMIT });
      if (res.ok) {
        setLetters(res.letters);
        void pushHistory(joinCredentials(creds));
        if (res.letters.length === 0) setError(t('mail.empty'));
      } else {
        setLetters(null);
        setError(t(`mail.error.${res.message}`, { defaultValue: res.message }));
      }
    } finally {
      setLoading(false);
    }
  };

  /** Что сейчас в полях — или `null`, если открывать нечего. */
  const current = (): Credentials | null => {
    const e = email.trim();
    if (!e || !password) return null;
    return { email: e, password };
  };

  const submit = () => {
    const creds = current();
    if (!creds) {
      setError(t('mail.invalidInput'));
      return;
    }
    void run(creds);
  };

  /** Открыть ящик из истории — и заодно положить его в поля. */
  const useEntry = (entry: string) => {
    const creds = splitCredentials(entry);
    if (!creds) return;
    setEmail(creds.email);
    setPassword(creds.password);
    setQuery('');
    void run(creds);
  };

  /** Вставка `email:password` целиком. */
  const onEmailInput = (value: string) => {
    const pair = splitCredentials(value);
    if (pair) {
      setEmail(pair.email);
      setPassword(pair.password);
    } else {
      setEmail(value);
    }
    setError(null);
  };

  const copyCode = async (f: LetterFacts) => {
    if (!f.code) return;
    await navigator.clipboard.writeText(f.code);
    setCopiedId(f.letter.id);
  };

  useEffect(() => {
    if (!copiedId) return;
    const id = setTimeout(() => setCopiedId(null), COPIED_MS);
    return () => clearTimeout(id);
  }, [copiedId]);

  // A hand-over from another view: the pending target is consumed once, on
  // mount, and cleared immediately. Adding `run` to the deps would re-fetch the
  // same mailbox on every render that changes its identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only handover, see above
  useEffect(() => {
    const pending = useMailTarget.getState().pending;
    if (pending) {
      useMailTarget.getState().setPending(null);
      useEntry(pending);
    }
  }, []);

  return (
    <div className={s.container}>
      <div className={s.block}>
        <header className={s.header}>
          <h2 className={s.title}>{t('mail.title')}</h2>
          <p className={s.hint}>{t('mail.subtitle')}</p>
        </header>

        <div className={s.card}>
          <div className={s.pick}>
            <div className={s.field}>
              <AtSign size={16} className={s.fieldIcon} aria-hidden="true" />
              <input
                className={s.emailInput}
                value={email}
                onChange={(e) => onEmailInput(e.target.value)}
                placeholder={t('mail.emailPlaceholder')}
                aria-label={t('mail.emailPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <span className={s.fieldSep} />
              <input
                className={s.passInput}
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder={t('mail.passwordPlaceholder')}
                aria-label={t('mail.passwordPlaceholder')}
                spellCheck={false}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <Tooltip label={t(reveal ? 'mail.hidePassword' : 'mail.showPassword')}>
                <button
                  type="button"
                  className={s.iconBtn}
                  onClick={() => setReveal(!reveal)}
                  aria-label={t(reveal ? 'mail.hidePassword' : 'mail.showPassword')}
                  aria-pressed={reveal}
                >
                  {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </Tooltip>
            </div>
            <button
              type="button"
              className={s.fetchBtn}
              onClick={submit}
              disabled={loading || current() === null}
            >
              {loading ? <Loader2 size={16} className={s.spin} /> : <Search size={16} />}
              {/* Обе подписи лежат в одной ячейке грида, невидимая скрыта `visibility`. */}
              <span className={s.fetchLabel}>
                <span className={loading ? s.labelOff : undefined}>{t('mail.fetch')}</span>
                <span className={loading ? undefined : s.labelOff}>{t('mail.loading')}</span>
              </span>
            </button>
          </div>

          {/* Недавние ящики — фишками, в одну-две строки. */}
          {history.length > 0 && (
            <ul className={s.hist}>
              <li className={s.histLabel}>{t('mail.history')}</li>
              {history.map((entry) => (
                <li key={entry} className={s.histChip}>
                  <button
                    type="button"
                    className={s.histUse}
                    onClick={() => useEntry(entry)}
                    disabled={loading}
                  >
                    {splitCredentials(entry)?.email ?? entry}
                  </button>
                  <button
                    type="button"
                    className={s.histDrop}
                    onClick={() => void removeHistory(entry)}
                    aria-label={t('mail.removeFromHistory')}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className={s.error}>{error}</p>}

        {loading && (
          <div className={s.state}>
            <Loader2 size={26} className={s.spin} />
            <span>{t('mail.loadingHint')}</span>
          </div>
        )}

        {!loading && letters && letters.length > 0 && (
          <div className={s.card}>
            <div className={s.toolbar}>
              <div className={s.search}>
                <Search size={15} className={s.searchIcon} aria-hidden="true" />
                <input
                  type="search"
                  className={s.searchInput}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('mail.searchPlaceholder')}
                  aria-label={t('mail.searchPlaceholder')}
                  spellCheck={false}
                />
              </div>
              {/* Две фишки, одна выбрана: «с кодами» — то, зачем сюда заходят, «все» — то, куда возвращаются. */}
              {codeCount > 0 && (
                <button
                  type="button"
                  className={`${s.chip} ${onlyCodes ? s.chipOn : ''}`}
                  onClick={() => setOnlyCodes(true)}
                  aria-pressed={onlyCodes}
                >
                  {t('mail.onlyCodes')}
                  <span className={s.chipCount}>{codeCount}</span>
                </button>
              )}
              <button
                type="button"
                className={`${s.chip} ${onlyCodes ? '' : s.chipOn}`}
                onClick={() => setOnlyCodes(false)}
                aria-pressed={!onlyCodes}
              >
                {t('mail.allLetters')}
                <span className={s.chipCount}>{facts.length}</span>
              </button>
              <Tooltip label={t('mail.refresh')}>
                <button
                  type="button"
                  className={s.iconBtn}
                  onClick={submit}
                  disabled={loading || current() === null}
                  aria-label={t('mail.refresh')}
                >
                  <RefreshCw size={16} />
                </button>
              </Tooltip>
            </div>

            {shown.length === 0 ? (
              <p className={s.nothing}>{t('mail.nothingFound')}</p>
            ) : (
              <ul className={s.list}>
                {shown.map((f) => {
                  const { letter } = f;
                  const open = openId === letter.id;
                  const copied = copiedId === letter.id;
                  const short = formatShortDate(letter.date, i18n.language);
                  const full = formatFullDate(letter.date, i18n.language);
                  const subject = letter.subject?.trim();
                  const from = letter.from?.trim();
                  // Тема — то, по чему письмо узнают, и она стоит первой строкой.
                  const title = subject || from || t('mail.unknownSender');
                  return (
                    <li key={letter.id} className={`${s.letter} ${open ? s.letterOpen : ''}`}>
                      <div className={s.head}>
                        {/* Кнопка раскрытия — прозрачный слой во всю строку. */}
                        <button
                          type="button"
                          className={s.headHit}
                          onClick={() => setOpenId(open ? null : letter.id)}
                          aria-expanded={open}
                          aria-label={title}
                        />
                        <div className={s.headText}>
                          <span className={s.subject}>{title}</span>
                          <span className={s.from}>
                            {subject && from && (
                              <>
                                {from}
                                <span className={s.sep}>·</span>
                              </>
                            )}
                            {f.preview || t('mail.noPreview')}
                          </span>
                        </div>
                        {f.code && (
                          <Tooltip label={t(copied ? 'mail.copied' : 'mail.copyCode')}>
                            <button
                              type="button"
                              className={s.code}
                              onClick={() => void copyCode(f)}
                              aria-label={t('mail.copyCode')}
                            >
                              {f.code}
                              {copied ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          </Tooltip>
                        )}
                        {short &&
                          (full ? (
                            <Tooltip label={full}>
                              <span className={s.time}>{short}</span>
                            </Tooltip>
                          ) : (
                            <span className={s.time}>{short}</span>
                          ))}
                      </div>
                      {open && (
                        <div className={s.body}>
                          <div className={s.bodyInner}>
                            <LetterBody letter={letter} />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {!loading && !error && letters === null && (
          <div className={s.state}>
            <Inbox size={26} className={s.stateIcon} />
            <span>{t('mail.idle')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

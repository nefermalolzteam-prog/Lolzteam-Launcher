import type { AccountTag, ProxyEntry, ServiceId, UserLabel } from '@shared-types';
import { pinnedProxyFor } from '@shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loginMethodFor, loginMethodsFor } from '~/lib/loginService';
import { useDismiss } from '~/lib/useDismiss';
import { type MassActionId, useInventorySelection } from '~/stores/inventorySelection';
import { useLocalLabels } from '~/stores/localLabels';
import { type LoginMethod, useLoginSession } from '~/stores/loginSession';
import { useMailTarget } from '~/stores/mailTarget';
import { useProfileLabels } from '~/stores/profileLabels';
import { patchSettings, useSettings } from '~/stores/settings';
import { useView } from '~/stores/view';
import type { ProxyTest } from '../ProxyChoiceModal';
import { patchAccountNote, patchAccountTags, reloadAccounts } from './cardCache';
import type { AccountFacts } from './facts';

const EMPTY_PROXIES: ProxyEntry[] = [];
const EMPTY_PINS: Record<string, string> = {};
const EMPTY_SERVICES: ServiceId[] = [];
const EMPTY_PREFS: Partial<Record<ServiceId, LoginMethod>> = {};

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const isRateLimitMessage = (msg: string): boolean => /\b429\b|rate.?limit/i.test(msg);

/** Which question the proxy list is being asked, or `null` for «not open». */
export type ProxyPick = { mode: 'login'; autoTestId: string | null } | { mode: 'pin' };

/** What the card's own check found, once it has finished finding it. */
export interface CheckOutcome {
  readonly valid: boolean;
  readonly reason?: string;
}

/** The modal deck — state no shape reads, handed straight to `AccountModals`. */
export interface AccountModalDeck {
  readonly sdaOpen: boolean;
  readonly closeSda: () => void;

  readonly methodOpen: boolean;
  readonly chooseMethod: (method: LoginMethod, remember: boolean) => void;
  readonly cancelMethod: () => void;

  readonly warnOpen: boolean;
  readonly confirmWarn: () => void;
  readonly cancelWarn: () => void;

  readonly proxyPick: ProxyPick | null;
  /** The route for this one login. */
  readonly chooseProxy: (proxyId: string | null, test?: ProxyTest | null) => void;
  /** The route from now on. */
  readonly pinProxy: (proxyId: string | null) => void;
  readonly cancelProxy: () => void;

  readonly checkOpen: boolean;
  readonly checking: boolean;
  readonly checkResult: CheckOutcome | null;
  readonly checkError: string | null;
  readonly closeCheck: () => void;

  /** The copy-into-the-base modal: open from the moment the copy starts. */
  readonly copyOpen: boolean;
  /** …or from the moment it needs an answer: the copy is standing at the warranty question and nothing has been asked. */
  readonly copyAsk: boolean;
  /** «Забрать maFile» — copy with the Steam Guard secret, at the guarantee's cost. */
  readonly confirmCopyMafile: () => void;
  /** «Скопировать без него» — the guarantee stays, the copy has no guard code. */
  readonly skipCopyMafile: () => void;
  readonly copying: boolean;
  /** Untranslated reason from main, `null` while running and on success. */
  readonly copyError: string | null;
  readonly closeCopy: () => void;

  readonly labelsOpen: boolean;
  readonly closeLabels: () => void;
  readonly labels: readonly UserLabel[];
  readonly labelsLoading: boolean;
  /** Ids of the labels whose toggle is still in flight. */
  readonly togglingTag: ReadonlySet<number>;
  readonly toggleLabel: (label: UserLabel) => void;

  readonly localLabelsOpen: boolean;
  readonly closeLocalLabels: () => void;

  readonly moveOpen: boolean;
  readonly closeMove: () => void;

  readonly noteOpen: boolean;
  readonly closeNote: () => void;

  /** The list has to come back from main — a folder or a local label changed it. */
  readonly onReload: () => void;
  /** The market took the note; write it into the list we already hold. */
  readonly onNoteSaved: (note: string | null) => void;
}

export interface AccountControls {
  /** This card's login is running — not merely some card's. */
  readonly busy: boolean;
  /** Seconds left of a 429 cooldown, `0` when there is none. */
  readonly cooldownLeft: number;
  readonly startLogin: () => void;
  readonly startSteamWebLogin: () => void;
  readonly startLlmWebLogin: () => void;

  readonly proxies: readonly ProxyEntry[];
  /** Whether a proxy would be offered at all for this account. */
  readonly proxyForThis: boolean;
  readonly pinnedProxy: ProxyEntry | null;
  readonly openProxyPin: () => void;

  readonly checking: boolean;
  readonly runCheck: () => void;

  /** Copy this bought account into the local base. */
  readonly copyToBase: () => void;

  /** Whichever label editor this account has — the market's or the base's. */
  readonly openLabels: () => void;
  readonly openNote: () => void;
  readonly openSda: () => void;
  readonly openMoveFolder: () => void;
  readonly openFolder: () => void;
  readonly openOnMarket: () => void;
  readonly openEmail: () => void;
  readonly askMass: (action: MassActionId) => void;

  readonly menuOpen: boolean;
  readonly toggleMenu: () => void;
  readonly closeMenu: () => void;
  /** Goes on the element wrapping the «⋯» button *and* its menu. */
  readonly menuRef: RefObject<HTMLDivElement | null>;

  readonly modals: AccountModalDeck;
}

export const useAccountControls = (facts: AccountFacts): AccountControls => {
  const { t } = useTranslation();
  const { item, service, isLocal, warranty } = facts;
  const qc = useQueryClient();

  const activeItemId = useLoginSession((s) => s.itemId);
  const step = useLoginSession((s) => s.step);
  const error = useLoginSession((s) => s.error);
  // Only spin while this card's login is actually running.
  const inProgress = step !== null && step !== 'done' && error === null;
  const busy = inProgress && activeItemId === item.itemId;

  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [, setCooldownTick] = useState(0);
  useEffect(() => {
    if (rateLimitedUntil === null) return;
    const id = setInterval(() => {
      setCooldownTick((n) => n + 1);
      if (Date.now() >= rateLimitedUntil) setRateLimitedUntil(null);
    }, 1000);
    return () => clearInterval(id);
  }, [rateLimitedUntil]);
  const cooldownLeft =
    rateLimitedUntil !== null ? Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000)) : 0;

  const [warnOpen, setWarnOpen] = useState(false);
  const [proxyPick, setProxyPick] = useState<ProxyPick | null>(null);
  const [methodModalOpen, setMethodModalOpen] = useState(false);
  const [sdaOpen, setSdaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckOutcome | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyAsk, setCopyAsk] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  // The local base has labels and folders of its own; both are edited in their own modal.
  const [localLabelsOpen, setLocalLabelsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [togglingTag, setTogglingTag] = useState<Set<number>>(new Set());

  const labels = useProfileLabels((p) => p.labels);
  const labelsLoading = useProfileLabels((p) => p.loading);
  const menuRef = useDismiss<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
  const pendingMethodRef = useRef<LoginMethod>('native');
  const pendingTagsRef = useRef<AccountTag[] | null>(null);

  const proxyEnabled = useSettings((s) => s.settings?.proxyEnabled ?? false);
  const proxies = useSettings((s) => s.settings?.proxies ?? EMPTY_PROXIES);
  const proxyServices = useSettings((s) => s.settings?.proxyServices ?? EMPTY_SERVICES);
  const accountProxies = useSettings((s) => s.settings?.accountProxies ?? EMPTY_PINS);
  const preferredLoginMethod = useSettings((s) => s.settings?.preferredLoginMethod ?? EMPTY_PREFS);

  const proxyForThis =
    proxyEnabled &&
    proxies.length > 0 &&
    item.category !== null &&
    proxyServices.includes(item.category);
  /** The proxy this account is pinned to, if any — the same answer main's mass runs get, from the same function. */
  const pinnedProxy = pinnedProxyFor(
    { proxyEnabled, proxies, proxyServices, accountProxies },
    item.itemId,
    item.category,
  );

  /** Writes the pin, or forgets it. */
  const pinProxy = (proxyId: string | null) => {
    const key = String(item.itemId);
    const next = { ...accountProxies };
    if (proxyId === null) delete next[key];
    else next[key] = proxyId;
    void patchSettings({ accountProxies: next });
  };

  const runLogin = async (
    proxyId: string | null,
    proxyTest?: { ip: string; ms: number } | null,
  ) => {
    if (!service) return;
    const sess = useLoginSession.getState();
    sess.start(item.itemId, item.title, service, pendingMethodRef.current);
    try {
      const res = await window.launcher.accounts.login(
        item.itemId,
        pendingMethodRef.current,
        proxyId,
        proxyTest,
      );
      if (!res.ok) {
        const msg = res.message ?? t('inventory.card.loginFailedFallback');
        if (isRateLimitMessage(msg)) setRateLimitedUntil(Date.now() + RATE_LIMIT_COOLDOWN_MS);
        sess.fail(msg);
      }
    } catch (err) {
      sess.fail(err instanceof Error ? err.message : t('inventory.card.callError'));
    }
  };

  const proceedWithProxy = (proxyId: string | null, proxyTest?: ProxyTest | null) => {
    void runLogin(proxyId, proxyTest ?? null);
  };

  const proceedAfterWarn = () => {
    const nativeNoProxy = service === 'steam' && pendingMethodRef.current === 'native';
    const canProxy = proxyForThis && !nativeNoProxy;
    if (!canProxy) {
      proceedWithProxy(null);
      return;
    }
    // A pinned account has already answered this question.
    setProxyPick({ mode: 'login', autoTestId: pinnedProxy?.id ?? null });
  };

  const startLoginWithMethod = (method: LoginMethod) => {
    pendingMethodRef.current = method;
    // Steam sign-in may need to fetch the mafile (for a Steam Guard code), which cancels the account's active warranty.
    if (service === 'steam' && warranty) {
      setWarnOpen(true);
      return;
    }
    proceedAfterWarn();
  };

  const startLogin = () => {
    if (!service) return;
    const methods = loginMethodsFor(service);
    if (methods.length <= 1) {
      startLoginWithMethod(methods[0] ?? loginMethodFor(service));
      return;
    }
    const saved = item.category ? preferredLoginMethod[item.category] : undefined;
    if (saved && methods.includes(saved)) {
      startLoginWithMethod(saved);
      return;
    }
    setMethodModalOpen(true);
  };

  const chooseMethod = (method: LoginMethod, remember: boolean) => {
    setMethodModalOpen(false);
    if (remember && item.category) {
      void window.launcher.settings
        .set({ preferredLoginMethod: { ...preferredLoginMethod, [item.category]: method } })
        .then((next) => useSettings.getState().set(next.settings));
    }
    startLoginWithMethod(method);
  };

  const startSteamWebLogin = () => {
    if (service !== 'steam') return;
    pendingMethodRef.current = 'web';
    if (warranty) {
      setWarnOpen(true);
      return;
    }
    proceedAfterWarn();
  };

  const startLlmWebLogin = () => {
    if (service !== 'llm') return;
    pendingMethodRef.current = 'web';
    proceedAfterWarn();
  };

  const runCheck = async () => {
    if (checking) return;
    setCheckOpen(true);
    setChecking(true);
    setCheckResult(null);
    setCheckError(null);
    pendingTagsRef.current = null;
    try {
      const res = await window.launcher.accounts.check(item.itemId);
      if (res.ok) {
        pendingTagsRef.current = res.tags;
        setCheckResult({ valid: res.valid, reason: res.reason });
      } else {
        setCheckError(res.message);
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : t('inventory.card.callError'));
    } finally {
      setChecking(false);
    }
  };

  /** The verdict lands in the list only once the user has read it. */
  const closeCheck = () => {
    setCheckOpen(false);
    const tags = pendingTagsRef.current;
    if (tags) {
      patchAccountTags(qc, item.itemId, () => tags);
      pendingTagsRef.current = null;
    }
  };

  /** Copy this bought account into the local base. */
  const runCopyToBase = async (mafile: 'fetch' | 'skip') => {
    if (copying) return;
    setCopyAsk(false);
    setCopyOpen(true);
    setCopying(true);
    setCopyError(null);
    try {
      const res = await window.launcher.localAccounts.copyFromMarket(item.itemId, mafile);
      if (!res.ok) setCopyError(res.message);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : t('inventory.card.callError'));
    } finally {
      setCopying(false);
    }
  };

  /** …and the question that comes first, for the one account that has one. */
  const copyToBase = () => {
    if (copying) return;
    if (item.category !== 'steam') {
      void runCopyToBase('skip');
      return;
    }
    if (warranty === null) {
      void runCopyToBase('fetch');
      return;
    }
    setCopyError(null);
    setCopyAsk(true);
    setCopyOpen(true);
  };

  /** The list is only refetched once the copy is over and read. */
  const closeCopy = () => {
    setCopyOpen(false);
    if (!copyAsk && copyError === null) reloadAccounts(qc);
    setCopyAsk(false);
  };

  const toggleLabel = async (label: UserLabel) => {
    if (togglingTag.has(label.id)) return;
    const attached = (item.tags ?? []).some((tg) => tg.id === label.id);
    setTogglingTag((prev) => new Set(prev).add(label.id));
    try {
      const res = attached
        ? await window.launcher.accounts.removeTag(item.itemId, label.id)
        : await window.launcher.accounts.addTag(item.itemId, label.id);
      if (res.ok) {
        patchAccountTags(qc, item.itemId, (tags) =>
          attached
            ? tags.filter((tg) => tg.id !== label.id)
            : tags.some((tg) => tg.id === label.id)
              ? tags
              : [...tags, { id: label.id, title: label.title, bc: label.bc }],
        );
      }
    } finally {
      setTogglingTag((prev) => {
        const next = new Set(prev);
        next.delete(label.id);
        return next;
      });
    }
  };

  /** The base's labels and the market's are two editors; the card offers one. */
  const openLabels = () => {
    if (isLocal) {
      setLocalLabelsOpen(true);
      void useLocalLabels.getState().load();
      return;
    }
    setLabelsOpen(true);
    void useProfileLabels.getState().load();
  };

  // Everything the launcher knows about a hand-added account is in one folder.
  const openFolder = () => {
    const service =
      item.category === 'steam' || item.category === 'telegram' ? item.category : null;
    void window.launcher.localAccounts.revealFolder(item.itemId, service);
  };

  // Open this account's email inbox on the Mail page (letters via the LZT API).
  const openEmail = async () => {
    try {
      const creds = await window.launcher.accounts.mailCreds(item.itemId);
      if (!creds) return;
      useMailTarget.getState().setPending(`${creds.login}:${creds.password}`);
      useView.getState().setView('mail');
    } catch {
      // ignore — nothing to open
    }
  };

  return {
    busy,
    cooldownLeft,
    startLogin,
    startSteamWebLogin,
    startLlmWebLogin,

    proxies,
    proxyForThis,
    pinnedProxy,
    openProxyPin: () => setProxyPick({ mode: 'pin' }),

    checking,
    runCheck: () => void runCheck(),

    copyToBase,

    openLabels,
    openNote: () => setNoteOpen(true),
    openSda: () => setSdaOpen(true),
    openMoveFolder: () => setMoveOpen(true),
    openFolder,
    openOnMarket: () => {
      void window.launcher.app.openExternal(`https://lzt.market/${item.itemId}/`);
    },
    openEmail: () => void openEmail(),
    /** Run one of the mass operations on this account alone. */
    askMass: (action: MassActionId) => {
      useInventorySelection.getState().askFor([item.itemId], action);
    },

    menuOpen,
    toggleMenu: () => setMenuOpen((v) => !v),
    closeMenu: () => setMenuOpen(false),
    menuRef,

    modals: {
      sdaOpen,
      closeSda: () => setSdaOpen(false),

      methodOpen: methodModalOpen,
      chooseMethod,
      cancelMethod: () => setMethodModalOpen(false),

      warnOpen,
      confirmWarn: () => {
        setWarnOpen(false);
        proceedAfterWarn();
      },
      cancelWarn: () => setWarnOpen(false),

      proxyPick,
      chooseProxy: (proxyId, test) => {
        setProxyPick(null);
        proceedWithProxy(proxyId, test);
      },
      pinProxy: (proxyId) => {
        setProxyPick(null);
        pinProxy(proxyId);
      },
      cancelProxy: () => setProxyPick(null),

      checkOpen,
      checking,
      checkResult,
      checkError,
      closeCheck,

      copyOpen,
      copyAsk,
      confirmCopyMafile: () => void runCopyToBase('fetch'),
      skipCopyMafile: () => void runCopyToBase('skip'),
      copying,
      copyError,
      closeCopy,

      labelsOpen,
      closeLabels: () => setLabelsOpen(false),
      labels,
      labelsLoading,
      togglingTag,
      toggleLabel: (label) => void toggleLabel(label),

      localLabelsOpen,
      closeLocalLabels: () => setLocalLabelsOpen(false),

      moveOpen,
      closeMove: () => setMoveOpen(false),

      noteOpen,
      closeNote: () => setNoteOpen(false),

      onReload: () => reloadAccounts(qc),
      onNoteSaved: (note) => patchAccountNote(qc, item.itemId, note),
    },
  };
};

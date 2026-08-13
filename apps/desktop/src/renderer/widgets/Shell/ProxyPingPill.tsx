import type { LauncherSettings, ProxyEntry } from '@shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { proxyName } from '~/lib/proxy';
import { useSettings } from '~/stores/settings';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from './ProxyPingPill.module.scss';

type PingState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; ms: number }
  | { kind: 'fail' };

const activeProxy = (settings: LauncherSettings | null): ProxyEntry | null => {
  if (!settings?.appProxyId) return null;
  return settings.proxies.find((p) => p.id === settings.appProxyId) ?? null;
};

export const ProxyPingPill = () => {
  const { t } = useTranslation();
  const settings = useSettings((st) => st.settings);
  const proxy = activeProxy(settings);
  const [state, setState] = useState<PingState>({ kind: 'idle' });
  const reqRef = useRef(0);

  const check = useCallback(async () => {
    const ticket = ++reqRef.current;
    setState({ kind: 'checking' });
    const current = activeProxy(useSettings.getState().settings);
    try {
      if (current) {
        const res = await window.launcher.proxy.test({
          host: current.host,
          port: current.port,
          username: current.username,
          password: current.password,
        });
        if (ticket !== reqRef.current) return;
        setState(res.ok ? { kind: 'ok', ms: res.ms } : { kind: 'fail' });
      } else {
        const res = await window.launcher.app.pingApi();
        if (ticket !== reqRef.current) return;
        setState(res.online ? { kind: 'ok', ms: res.ms } : { kind: 'fail' });
      }
    } catch {
      if (ticket === reqRef.current) setState({ kind: 'fail' });
    }
  }, []);

  const sig = proxy ? `${proxy.host}:${proxy.port}:${proxy.username ?? ''}` : 'direct';
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on proxy change via sig
  useEffect(() => {
    void check();
  }, [sig, check]);

  const label = proxy ? proxyName(proxy) : t('topbar.proxyDirect');

  // `idle` живёт ровно один кадр — эффект ниже запускает проверку сразу.
  const busy = state.kind === 'checking' || state.kind === 'idle';
  const value =
    state.kind === 'ok' ? t('settings.proxy.ping', { ms: state.ms }) : t('topbar.pingFail');

  const dotClass =
    state.kind === 'ok' ? s.dotOk : state.kind === 'fail' ? s.dotFail : s.dotChecking;

  return (
    <Tooltip label={t('topbar.proxyRefresh')} placement="bottom">
      {/* Кнопка не выключается на время проверки: выключенная не показывает подсказку и меняет вид. */}
      <button
        type="button"
        className={s.pingItem}
        onClick={() => {
          if (!busy) void check();
        }}
        aria-busy={busy}
      >
        <span className={s.label}>{label}</span>
        <span className={s.dotGroup}>
          <span className={`${s.dot} ${dotClass}`} />
          {busy ? (
            <span className={s.skeleton} role="status" aria-label={t('topbar.pingChecking')} />
          ) : (
            // `key` по значению: новое число — новый узел, и появление проигрывается заново даже когда «87 мс» сменяется на «91 мс».
            <span key={value} className={s.value}>
              {value}
            </span>
          )}
        </span>
      </button>
    </Tooltip>
  );
};

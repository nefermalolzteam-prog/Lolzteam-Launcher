import type { ApiMonitorSnapshot } from '@shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from './ApiMonitorPage.module.scss';

/** The countdown has to tick every second — 30 s of «0:59» is a broken clock. */
const useSecondTick = (): number => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const statusClass = (status: number): string => {
  // A hashed name the build dropped reads as «other», not as a crash.
  const pick = (name: string | undefined): string => name ?? '';
  if (status === 429) return pick(s.rate);
  if (status >= 200 && status < 300) return pick(s.ok);
  if (status >= 400) return pick(s.bad);
  return pick(s.other);
};

/** The market-call journal: the ceiling, the pulse and the last requests. */
export const ApiMonitorPage = () => {
  const { t, i18n } = useTranslation();
  const now = useSecondTick();
  const stats = useQuery({
    queryKey: ['api-stats'],
    queryFn: (): Promise<ApiMonitorSnapshot> => window.launcher.app.apiStats(),
    // The journal grows on its own; the page just needs to keep looking at it.
    refetchInterval: 3000,
  });

  const data = stats.data;
  const max = data ? Math.max(1, ...data.perMinute) : 1;

  // `mm:ss` while the window the server named is still ahead; `null` once it
  // has passed — the next answer that carries the trio starts a new one.
  const resetLeft = data?.reset ?? null;
  const resetIn =
    resetLeft === null
      ? null
      : resetLeft * 1000 <= now
        ? null
        : (() => {
            const left = Math.ceil((resetLeft * 1000 - now) / 1000);
            return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
          })();

  const clock = new Intl.DateTimeFormat(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const minuteClock = new Intl.DateTimeFormat(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });

  // The bucket's own clock time, for the tooltip: newest bucket = this minute.
  const bucketTime = (i: number): string => {
    const at = now - (59 - i) * 60_000;
    return minuteClock.format(at);
  };

  return (
    <>
      <p className={s.sectionTitle}>{t('settings.apiMonitor.group')}</p>
      <div className={s.stats}>
        <div className={s.stat}>
          <span className={s.statLabel}>{t('settings.apiMonitor.limitLabel')}</span>
          <span className={s.statValue}>
            {data?.remaining !== null && data?.remaining !== undefined
              ? t('settings.apiMonitor.limitValue', {
                  remaining: data.remaining,
                  limit: data.limit ?? '?',
                })
              : '—'}
          </span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>{t('settings.apiMonitor.resetLabel')}</span>
          <span className={s.statValue}>{resetIn ?? '—'}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>{t('settings.apiMonitor.hourLabel')}</span>
          <span className={s.statValue}>{data?.lastHour ?? '—'}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>{t('settings.apiMonitor.minuteLabel')}</span>
          <span className={s.statValue}>{data?.lastMinute ?? '—'}</span>
        </div>
      </div>

      <p className={s.sectionTitle}>{t('settings.apiMonitor.pulseTitle')}</p>
      <div className={s.card}>
        <div className={s.chart}>
          {(data?.perMinute ?? new Array(60).fill(0)).map((count, i) => {
            const bar = (
              <span
                className={`${s.bar} ${count > 0 ? s.barHit : ''}`}
                style={{
                  height: count > 0 ? `${Math.max(6, Math.round((count / max) * 100))}%` : '2px',
                }}
              />
            );
            return (
              <Tooltip
                key={i}
                // Even an empty minute answers — «0 в 16:12» is also information.
                label={t('settings.apiMonitor.barTitle', { count, time: bucketTime(i) })}
              >
                {bar}
              </Tooltip>
            );
          })}
        </div>
        <div className={s.chartAxis}>
          <span>{t('settings.apiMonitor.axisHourAgo')}</span>
          <span>{t('settings.apiMonitor.axisNow')}</span>
        </div>
      </div>

      <p className={s.sectionTitle}>{t('settings.apiMonitor.recentTitle')}</p>
      <div className={s.card}>
        {!data || data.recent.length === 0 ? (
          <p className={s.empty}>{t('settings.apiMonitor.empty')}</p>
        ) : (
          <div className={s.rows}>
            {data.recent.map((entry) => (
              <div key={`${entry.at}-${entry.path}-${entry.status}`} className={s.row}>
                <span className={s.rowTime}>{clock.format(entry.at)}</span>
                <span className={s.rowMethod}>{entry.method}</span>
                <span className={s.rowPath}>{entry.path}</span>
                <span className={`${s.rowStatus} ${statusClass(entry.status)}`}>
                  {entry.status}
                </span>
                <span className={s.rowMs}>
                  {t('settings.apiMonitor.ms', { n: entry.durationMs })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

import type {
  TelegramConvertEntry,
  TelegramConvertRunResult,
  TelegramConvertScan,
  TelegramConvertTarget,
} from '@shared-types';
import { TELEGRAM_CONVERT_TARGETS } from '@shared-types';
import { FolderSearch, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalCheck,
  ModalChecks,
  ModalChip,
  ModalChips,
  ModalEmpty,
  ModalGroup,
  ModalHint,
  ModalIconButton,
  ModalNote,
  ModalOption,
  ModalStatus,
} from '~/widgets/Modal/ModalKit';
import s from './Base.module.scss';

const convertible = (entry: TelegramConvertEntry): boolean => entry.problem === null;

const short = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export const ConverterModal = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();

  const [scan, setScan] = useState<TelegramConvertScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());

  const [target, setTarget] = useState<TelegramConvertTarget>('tdata');
  const [withJson, setWithJson] = useState(true);
  const [outDir, setOutDir] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TelegramConvertRunResult | null>(null);

  const entries = scan?.entries ?? [];
  const ready = entries.filter(convertible);
  const chosen = ready.filter((e) => selected.has(e.id));
  const allOn = ready.length > 0 && chosen.length === ready.length;
  // Same reason as the mass bar's: a checkbox has a third state.
  const someOn = chosen.length > 0 && !allOn;

  const load = async (dir: string): Promise<void> => {
    setScanning(true);
    setResult(null);
    const next = await window.launcher.telegram.convertScan(dir);
    setScan(next);
    // Everything readable starts ticked: the common case is "convert this folder".
    setSelected(new Set(next.entries.filter(convertible).map((e) => e.id)));
    setScanning(false);
  };

  const pickSource = async (): Promise<void> => {
    const picked = await window.launcher.telegram.pickDir(t('base.converter.pickSourceTitle'));
    if (!picked.dir) return;
    await load(picked.dir);
  };

  const pickOut = async (): Promise<void> => {
    const picked = await window.launcher.telegram.pickDir(t('base.converter.pickOutTitle'));
    if (picked.dir) setOutDir(picked.dir);
  };

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const toggleAll = (): void =>
    setSelected(allOn ? new Set<string>() : new Set(ready.map((e) => e.id)));

  const run = async (): Promise<void> => {
    if (!scan || !outDir || chosen.length === 0 || running) return;
    setRunning(true);
    setResult(null);
    const res = await window.launcher.telegram.convertRun({
      dir: scan.dir,
      ids: chosen.map((e) => e.id),
      target,
      outDir,
      withJson,
    });
    setResult(res);
    setRunning(false);
  };

  const failures = result?.items.filter((it) => !it.ok) ?? [];

  return (
    <Modal
      title={t('base.converter.title')}
      size="lg"
      closable
      onClose={onClose}
      footer={
        <>
          {/* Счётчик — там же, где пояснение любого другого диалога: слева от кнопок, тише. */}
          <ModalNote>{t('base.converter.willConvert', { count: chosen.length })}</ModalNote>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={running}>
            {t('common.close')}
          </Button>
          <Button
            variant="accent"
            size="sm"
            busy={running}
            disabled={chosen.length === 0 || outDir === null}
            onClick={() => void run()}
          >
            {t('base.converter.run')}
          </Button>
        </>
      }
    >
      <ModalHint>{t('base.converter.lead')}</ModalHint>

      <ModalOption
        icon={FolderSearch}
        title={scan ? scan.dir : t('base.converter.pickSource')}
        tooltip={scan?.dir}
        action="none"
        onClick={() => void pickSource()}
        trailing={
          scan ? (
            <ModalIconButton
              icon={RefreshCw}
              label={t('base.converter.rescan')}
              disabled={scanning}
              onClick={() => void load(scan.dir)}
            />
          ) : undefined
        }
      />

      {scanning && <ModalStatus tone="busy" title={t('base.converter.scanning')} />}

      {!scanning && scan && entries.length === 0 && (
        <ModalEmpty>{t('base.converter.nothingFound')}</ModalEmpty>
      )}

      {!scanning && entries.length > 0 && (
        <>
          <div className={s.listHead}>
            <ModalCheck
              checked={allOn}
              indeterminate={someOn}
              disabled={ready.length === 0}
              onChange={toggleAll}
            >
              {t('base.selectAll')}
            </ModalCheck>
            <span className={s.counter}>
              {t('base.converter.found', { count: entries.length, skipped: scan?.skipped ?? 0 })}
            </span>
          </div>

          <div className={s.list}>
            {entries.map((entry) => {
              const broken = entry.problem !== null;
              return (
                <ModalOption
                  key={entry.id}
                  title={entry.name}
                  hint={[
                    t(`telegram.formats.${entry.format}`),
                    entry.dcId === null ? null : `DC ${entry.dcId}`,
                    entry.phone === null ? null : `+${entry.phone.replace(/^\+/, '')}`,
                    entry.userId === null ? null : String(entry.userId),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  selected={selected.has(entry.id)}
                  disabled={broken}
                  onClick={() => toggle(entry.id)}
                  // The parser's own words behind the verdict.
                  tooltip={entry.problemDetail ?? entry.path}
                  trailing={
                    <>
                      {entry.hasMeta && <span className={s.badge}>JSON</span>}
                      {broken && entry.problem !== null && (
                        <span className={`${s.badge} ${s.badgeBad}`}>
                          <TriangleAlert size={12} />
                          <span>{t(`telegram.problems.${entry.problem}`)}</span>
                        </span>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>

          <ModalGroup>{t('base.converter.target')}</ModalGroup>
          <ModalChips>
            {TELEGRAM_CONVERT_TARGETS.map((id) => (
              <ModalChip
                key={id}
                label={t(`telegram.formats.${id}`)}
                selected={target === id}
                onClick={() => setTarget(id)}
              />
            ))}
          </ModalChips>

          <ModalChecks>
            <ModalCheck checked={withJson} onChange={setWithJson}>
              {t('base.converter.withJson')}
            </ModalCheck>
          </ModalChecks>

          <ModalGroup>{t('base.converter.pickOut')}</ModalGroup>
          <ModalOption
            icon={FolderSearch}
            title={outDir ?? t('base.converter.pickOut')}
            tooltip={outDir ?? undefined}
            action="none"
            onClick={() => void pickOut()}
          />
        </>
      )}

      {result && (
        <div className={s.result}>
          <p className={s.resultLine}>
            {t('base.converter.done', { count: result.converted, dir: short(result.outDir) })}
          </p>
          {failures.length > 0 && (
            <ul className={s.failures}>
              {failures.map((item) => (
                <li key={item.id}>
                  <span className={s.rowTitle}>{item.name}</span>
                  <span className={s.rowMeta}>{item.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
};

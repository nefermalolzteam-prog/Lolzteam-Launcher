import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SdaModal } from '~/features/guard/SdaModal';
import { labelColors } from '~/lib/labelColor';
import { loginMethodsFor } from '~/lib/loginService';
import { Button } from '~/widgets/Button/Button';
import { Modal } from '~/widgets/Modal/Modal';
import {
  ModalEmpty,
  ModalHint,
  ModalOption,
  ModalSpacer,
  ModalStatus,
} from '~/widgets/Modal/ModalKit';
import s from '../AccountCard.module.scss';
import { LocalLabelsModal } from '../LocalLabelsModal';
import { LoginMethodModal } from '../LoginMethodModal';
import { MoveFolderModal } from '../MoveFolderModal';
import { NoteModal } from '../NoteModal';
import { ProxyChoiceModal } from '../ProxyChoiceModal';
import { localErrorText } from '../localErrors';
import type { AccountControls } from './controls';
import type { AccountFacts } from './facts';

/** The nine modals a card can open, in one place. */
export const AccountModals = ({
  facts,
  controls,
}: {
  facts: AccountFacts;
  controls: AccountControls;
}) => {
  const { t } = useTranslation();
  const { item, service, warranty } = facts;
  const m = controls.modals;

  return (
    <>
      {m.sdaOpen && <SdaModal item={item} onClose={m.closeSda} />}

      {m.methodOpen && service && (
        <LoginMethodModal
          methods={loginMethodsFor(service)}
          onChoose={m.chooseMethod}
          onCancel={m.cancelMethod}
        />
      )}

      {m.warnOpen && (
        <Modal
          title={t('inventory.card.warrantyWarnTitle')}
          subtitle={item.title}
          size="md"
          onClose={m.cancelWarn}
          footer={
            <>
              <ModalSpacer />
              <Button variant="ghost" size="sm" onClick={m.cancelWarn}>
                {t('inventory.card.warrantyWarnCancel')}
              </Button>
              {/* Красная, а не зелёная: нажатие снимает гарантию, и цвет — последнее, что об этом успевает сказать. */}
              <Button variant="danger" size="sm" onClick={m.confirmWarn}>
                {t('inventory.card.warrantyWarnConfirm')}
              </Button>
            </>
          }
        >
          <ModalHint>{t('inventory.card.warrantyWarnBody', { warranty })}</ModalHint>
        </Modal>
      )}

      {/* The route for this login. */}
      {m.proxyPick?.mode === 'login' && (
        <ProxyChoiceModal
          proxies={controls.proxies}
          autoTestId={m.proxyPick.autoTestId}
          onChoose={m.chooseProxy}
          onCancel={m.cancelProxy}
        />
      )}

      {/* …and the same list asked the other question: through what does this account go from now on, here and in every mass run. */}
      {m.proxyPick?.mode === 'pin' && (
        <ProxyChoiceModal
          proxies={controls.proxies}
          mode="pin"
          currentId={controls.pinnedProxy?.id ?? null}
          onChoose={m.pinProxy}
          onCancel={m.cancelProxy}
        />
      )}

      {m.checkOpen && (
        <Modal
          title={t('inventory.card.checkTitle')}
          subtitle={item.title}
          size="md"
          onClose={m.closeCheck}
          footer={
            <>
              <ModalSpacer />
              <Button variant="accent" size="sm" onClick={m.closeCheck}>
                {t('inventory.card.checkClose')}
              </Button>
            </>
          }
        >
          {m.checking ? (
            <ModalStatus tone="busy" title={t('inventory.card.checking')} />
          ) : m.checkError ? (
            <ModalStatus
              tone="warn"
              title={t('inventory.card.checkErrorBody')}
              hint={m.checkError}
            />
          ) : m.checkResult ? (
            m.checkResult.valid ? (
              <ModalStatus tone="ok" title={t('inventory.card.checkValidResult')} />
            ) : (
              <ModalStatus
                tone="bad"
                title={t('inventory.card.checkInvalidResult')}
                hint={m.checkResult.reason}
              />
            )
          ) : null}
        </Modal>
      )}

      {/* The same three states as the check above, and deliberately the same markup: a copy is another action that goes away. */}
      {m.copyOpen && (
        <Modal
          title={t('inventory.card.copyToBase.title')}
          subtitle={item.title}
          size="md"
          onClose={m.closeCopy}
          footer={
            m.copyAsk ? (
              <>
                <ModalSpacer />
                <Button variant="ghost" size="sm" onClick={m.skipCopyMafile}>
                  {t('inventory.card.copyToBase.mafileSkip')}
                </Button>
                <Button variant="danger" size="sm" onClick={m.confirmCopyMafile}>
                  {t('inventory.card.copyToBase.mafileFetch')}
                </Button>
              </>
            ) : (
              <>
                <ModalSpacer />
                <Button variant="accent" size="sm" onClick={m.closeCopy}>
                  {t('inventory.card.checkClose')}
                </Button>
              </>
            )
          }
        >
          {m.copyAsk ? (
            <ModalHint>{t('inventory.card.copyToBase.mafileBody', { warranty })}</ModalHint>
          ) : m.copying ? (
            <ModalStatus tone="busy" title={t('inventory.card.copyToBase.running')} />
          ) : m.copyError !== null ? (
            <ModalStatus
              tone="warn"
              title={t('inventory.card.copyToBase.failed')}
              hint={localErrorText(t, m.copyError)}
            />
          ) : (
            <ModalStatus
              tone="ok"
              title={t('inventory.card.copyToBase.done')}
              hint={t('inventory.card.copyToBase.doneSub')}
            />
          )}
        </Modal>
      )}

      {m.labelsOpen && (
        <Modal
          title={t('inventory.card.labelsTitle')}
          subtitle={item.title}
          size="md"
          closable
          onClose={m.closeLabels}
          footer={
            <>
              <ModalSpacer />
              <Button variant="ghost" size="sm" onClick={m.closeLabels}>
                {t('common.close')}
              </Button>
            </>
          }
        >
          {m.labelsLoading && m.labels.length === 0 ? (
            <ModalStatus tone="busy" title={t('inventory.card.checking')} />
          ) : m.labels.length === 0 ? (
            <ModalEmpty>{t('inventory.card.labelsEmpty')}</ModalEmpty>
          ) : (
            m.labels.map((label) => {
              const attached = (item.tags ?? []).some((tg) => tg.id === label.id);
              const busyTag = m.togglingTag.has(label.id);
              const c = labelColors(label.bc);
              return (
                <ModalOption
                  key={label.id}
                  title={
                    <span
                      className={s.labelChip}
                      style={{ backgroundColor: c.background, color: c.text }}
                    >
                      {label.title}
                    </span>
                  }
                  selected={attached}
                  disabled={busyTag}
                  // Пока метка переключается, на месте галки крутится колесо: строка отвечает сама за себя, а не гаснет целиком.
                  trailing={
                    busyTag ? <Loader2 size={15} className={s.spin} aria-hidden /> : undefined
                  }
                  onClick={() => m.toggleLabel(label)}
                />
              );
            })
          )}
        </Modal>
      )}

      {m.localLabelsOpen && (
        <LocalLabelsModal item={item} onClose={m.closeLocalLabels} onSaved={m.onReload} />
      )}

      {m.moveOpen && <MoveFolderModal item={item} onClose={m.closeMove} onMoved={m.onReload} />}

      {m.noteOpen && <NoteModal item={item} onClose={m.closeNote} onSaved={m.onNoteSaved} />}
    </>
  );
};

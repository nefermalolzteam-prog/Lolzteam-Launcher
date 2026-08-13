import type { LocalServiceId } from '@shared-types';
import { LOCAL_SERVICE_IDS, serviceLabel } from '@shared-types';
import { useTranslation } from 'react-i18next';
import { serviceLogo } from '~/lib/serviceLogos';
import s from './LocalImport.module.scss';

/** Step 1: which service the accounts belong to. */
export const ServiceStep = ({ onPick }: { onPick: (id: LocalServiceId) => void }) => {
  const { t } = useTranslation();
  return (
    <div className={s.body}>
      <p className={s.lead}>{t('inventory.localImport.serviceLead')}</p>
      <div className={s.cards}>
        {LOCAL_SERVICE_IDS.map((id) => {
          const logo = serviceLogo(id);
          return (
            <button key={id} type="button" className={s.card} onClick={() => onPick(id)}>
              {logo && <img className={s.cardLogo} src={logo} alt="" />}
              <span className={s.cardTitle}>{serviceLabel(id)}</span>
              <span className={s.cardText}>{t(`inventory.localImport.serviceText.${id}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

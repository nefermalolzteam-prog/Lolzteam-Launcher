import type { ReactElement } from 'react';
import { Tooltip } from '~/widgets/Tooltip/Tooltip';
import s from './AvatarPreview.module.scss';

/** The account's own photo at the size it was stored, while the pointer rests on the thumb. */
export const AvatarPreview = ({ src, children }: { src: string; children: ReactElement }) => (
  <Tooltip
    // Longer than the default: the pointer crosses a column of avatars on its way anywhere.
    delay={320}
    label={<img className={s.preview} src={src} alt="" />}
  >
    {children}
  </Tooltip>
);

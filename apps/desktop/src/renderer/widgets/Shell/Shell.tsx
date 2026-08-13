import type { AuthSession } from '@shared-types';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { useView } from '~/stores/view';
import s from './Shell.module.scss';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { ScrollRootProvider } from './scrollRoot';

interface ShellProps {
  session: AuthSession | null;
}

export const Shell = ({ session, children }: PropsWithChildren<ShellProps>) => {
  const view = useView((st) => st.view);
  // State rather than a ref: the account grid virtualizes against this element and has to re-render once it exists.
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  return (
    // Around the whole shell rather than around `children`.
    <ScrollRootProvider value={scrollRoot}>
      <div className={s.layout}>
        <Sidebar />
        <div className={s.main}>
          {/* Above the scroll root, not inside it: the header holds its place and the list stops where the header ends. */}
          <div className={s.header}>
            <TopBar session={session} />
          </div>
          <main className={s.content} data-scroll-root ref={setScrollRoot}>
            <div key={view} className={s.viewTransition}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </ScrollRootProvider>
  );
};

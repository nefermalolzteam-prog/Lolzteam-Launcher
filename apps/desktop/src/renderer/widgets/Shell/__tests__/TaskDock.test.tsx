import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TaskDraft, useTasks } from '~/stores/tasks';
import { renderWithProviders, t } from '~/testing/render';
import { TaskDock } from '../TaskDock';

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  id: 'run:check',
  kind: 'run',
  title: { key: 'tasks.run.check' },
  detail: { key: 'tasks.run.detail', params: { done: 3, total: 10 } },
  done: 3,
  total: 10,
  ...over,
});

/** A source posting its list, from outside React — hence the `act`. */
const post = (...drafts: readonly TaskDraft[]): void => {
  act(() => {
    useTasks.getState().sync('run', drafts);
  });
};

/** The pill, which is also the only thing on screen when the list is closed. */
const trigger = (count: number): HTMLElement =>
  screen.getByRole('button', { name: t('tasks.count', { count }) });

afterEach(() => {
  useTasks.getState().clear();
});

describe('TaskDock', () => {
  it('draws nothing at all while nothing is running', () => {
    const { container } = renderWithProviders(<TaskDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears when a task is posted and names how many there are', () => {
    renderWithProviders(<TaskDock />);
    post(draft(), draft({ id: 'run:profile', title: { key: 'tasks.run.profile' } }));
    expect(trigger(2)).toBeInTheDocument();
    // Closed until asked for: the pill is the whole of the idle-ish state.
    expect(trigger(2)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('opens the list on hover, with a bar per task and the combined percent', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskDock />);
    post(draft(), draft({ id: 'run:cleanup', title: { key: 'tasks.run.cleanup' }, done: 1 }));

    await user.hover(trigger(2));

    const list = screen.getByRole('status');
    expect(list).toHaveTextContent(t('tasks.run.check'));
    expect(list).toHaveTextContent(t('tasks.run.cleanup'));
    // 3/10 and 1/10 — the mean of what can measure itself, not a summed ratio.
    expect(
      screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-valuenow')),
    ).toEqual(['30', '10']);
    expect(trigger(2)).toHaveTextContent(t('tasks.percent', { percent: 20 }));
  });

  it('leaves a task that cannot measure itself indeterminate rather than at zero', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskDock />);
    post(draft({ done: 0, total: null }));

    await user.hover(trigger(1));
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('offers a ✕ only for work that can be stopped, and stops it', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    renderWithProviders(<TaskDock />);

    post(draft());
    // Pinned rather than hovered, because the click below moves the pointer from the pill to the ✕.
    await user.click(trigger(1));
    expect(screen.queryByRole('button', { name: t('tasks.cancel') })).not.toBeInTheDocument();

    post(draft({ cancel }));
    await user.click(screen.getByRole('button', { name: t('tasks.cancel') }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps a finished member of a bundle on the list, marked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskDock />);
    post(
      draft({
        children: [
          {
            id: 'c1',
            title: { key: 'tasks.accounts.title', params: { service: 'Steam' } },
            detail: { key: 'tasks.accounts.childDone', params: { loaded: 12 } },
            state: 'done',
            done: 12,
            total: 12,
          },
          {
            id: 'c2',
            title: { key: 'tasks.accounts.title', params: { service: 'Telegram' } },
            detail: null,
            state: 'waiting',
            done: 0,
            total: null,
          },
        ],
      }),
    );

    await user.hover(trigger(1));
    const list = screen.getByRole('status');
    expect(list).toHaveTextContent('Steam');
    expect(list).toHaveTextContent('Telegram');
    expect(list).toHaveTextContent(t('tasks.accounts.childDone', { loaded: 12 }));
  });

  /** The one the user reported: pin the list open, let the work finish, start something else half an hour later. */
  it('comes back closed after the list it was showing emptied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskDock />);

    post(draft());
    await user.click(trigger(1));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(trigger(1)).toHaveAttribute('aria-expanded', 'true');

    post();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    post(draft({ id: 'run:privacy', title: { key: 'tasks.run.privacy' } }));
    expect(trigger(1)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('closes a pinned list on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaskDock />);
    post(draft());

    await user.click(trigger(1));
    expect(screen.getByRole('status')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    // The pointer is over the dock after a click, so hover alone keeps it open; what Escape has to undo is the pin.
    await user.unhover(trigger(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, t } from '~/testing/render';
import { Modal } from '../Modal';

const Dialog = (props: { onClose?: () => void; closable?: boolean }) => (
  <Modal title="Удалить аккаунт" {...props}>
    <button type="button">Отмена</button>
    <button type="button">Удалить</button>
  </Modal>
);

describe('Modal', () => {
  it('renders as a modal dialog labelled by its title', () => {
    renderWithProviders(<Dialog />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Удалить аккаунт');
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
  });

  it('puts the ring on the first control inside, not on the page behind', () => {
    renderWithProviders(<Dialog />);
    expect(screen.getByRole('button', { name: t('common.close') })).toHaveFocus();
  });

  it('keeps Tab inside the card', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dialog />);
    const close = screen.getByRole('button', { name: t('common.close') });
    const cancel = screen.getByRole('button', { name: 'Отмена' });
    const remove = screen.getByRole('button', { name: 'Удалить' });

    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(remove).toHaveFocus();
    // The one that matters: from the last control forward is the first control, not whatever the account list has at the top.
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(remove).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<Dialog onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click on the backdrop but not inside the card', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<Dialog onClose={onClose} />);

    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    // The backdrop is the dialog's parent — the only element a click can land on without landing on the card.
    const backdrop = screen.getByRole('presentation');
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers no way out when it is not closable', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<Dialog onClose={onClose} closable={false} />);

    expect(screen.queryByRole('button', { name: t('common.close') })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('presentation'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('gives the ring back to whatever opened it', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = renderWithProviders(<Dialog />);
    expect(trigger).not.toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});

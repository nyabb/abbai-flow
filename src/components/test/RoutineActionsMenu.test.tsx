import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nContext, createI18n } from '../../i18n';
import { RoutineActionsMenu } from '../routines/RoutineActionsMenu';

const i18n = createI18n('en');

function renderMenu(onEdit = vi.fn(), onDelete = vi.fn()) {
  const result = render(
    <I18nContext.Provider value={i18n}>
      <RoutineActionsMenu routineName="School mornings" onEdit={onEdit} onDelete={onDelete} />
    </I18nContext.Provider>,
  );
  return { ...result, onEdit, onDelete };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RoutineActionsMenu', () => {
  it('opens the dropdown and edits the selected routine', () => {
    const { onEdit } = renderMenu();
    const trigger = screen.getByRole('button', { name: 'Actions: School mornings' });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit School mornings' }));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('requires a second delete click and invokes the delete callback', () => {
    const { onDelete } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Actions: School mornings' }));
    const deleteAction = screen.getByRole('menuitem', { name: 'Delete School mornings' });

    fireEvent.click(deleteAction);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete for sure?')).toBeInTheDocument();

    fireEvent.click(deleteAction);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and when clicking outside the menu', () => {
    const { container } = renderMenu();
    const trigger = screen.getByRole('button', { name: 'Actions: School mornings' });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(container.querySelector('.routine-actions')).toBeInTheDocument();
  });

  it('clears delete confirmation after its timeout', () => {
    vi.useFakeTimers();
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Actions: School mornings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete School mornings' }));

    vi.advanceTimersByTime(3000);
    expect(screen.getByRole('menuitem', { name: 'Delete School mornings' })).toBeInTheDocument();
  });
});

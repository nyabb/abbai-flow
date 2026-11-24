import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nContext, createI18n } from '../../i18n';
import type { Routine } from '../../types/family';
import { RoutineCard } from '../focus/RoutineCard';

vi.mock('../../hooks/useHaptics', () => ({
  hapticMedium: vi.fn(),
  hapticSuccess: vi.fn(),
}));

const i18n = createI18n('en');
const routine: Routine = {
  id: 'routine-1',
  name: 'School mornings',
  member_id: 'child-1',
  time_of_day: 'morning',
  tasks: [
    { id: 'task-1', name: 'Brush teeth', order: 0 },
    { id: 'task-2', name: 'Pack bag', order: 1 },
  ],
};

function renderCard(overrides: Partial<Parameters<typeof RoutineCard>[0]> = {}) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onToggleTask = vi.fn();
  const result = render(
    <I18nContext.Provider value={i18n}>
      <RoutineCard
        routine={routine}
        label=""
        interactive
        isTaskCompleted={() => false}
        onToggleTask={onToggleTask}
        onEdit={onEdit}
        onDelete={onDelete}
        {...overrides}
      />
    </I18nContext.Provider>,
  );
  return { ...result, onEdit, onDelete, onToggleTask };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RoutineCard', () => {
  it('shows routine tasks and opens the shared edit action', () => {
    const { onEdit } = renderCard();
    expect(screen.getByText('Brush teeth')).toBeInTheDocument();
    expect(screen.getByText('Pack bag')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions: School mornings' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit School mornings' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('deletes the displayed routine after the confirmation click', () => {
    const { onDelete } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Actions: School mornings' }));
    const deleteAction = screen.getByRole('menuitem', { name: 'Delete School mornings' });
    fireEvent.click(deleteAction);
    fireEvent.click(deleteAction);
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('keeps future routine previews read-only', () => {
    const { onToggleTask } = renderCard({ interactive: false });
    const complete = screen.getByRole('button', { name: 'Complete Brush teeth' });
    expect(complete).toBeDisabled();
    complete.removeAttribute('disabled');
    fireEvent.click(complete);
    expect(onToggleTask).not.toHaveBeenCalled();
  });

  it('animates a completing task and triggers the finish haptic for the last step', () => {
    vi.useFakeTimers();
    const { onToggleTask } = renderCard({ isTaskCompleted: (taskId) => taskId === 'task-2' });
    const firstTask = screen.getByRole('button', { name: 'Complete Brush teeth' });

    fireEvent.click(firstTask);
    expect(onToggleTask).toHaveBeenCalledWith('task-1');
    expect(firstTask).toHaveClass('focus-check-row--completing');
    expect(screen.getByRole('button', { name: 'Undo Pack bag' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(400));
    expect(firstTask).not.toHaveClass('focus-check-row--completing');
  });

  it('allows undo, shows completed routines, and keeps an empty routine count valid', () => {
    const completed = renderCard({ isTaskCompleted: (taskId) => taskId === 'task-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Undo Brush teeth' }));
    expect(completed.onToggleTask).toHaveBeenCalledWith('task-1');
    completed.unmount();

    const allDone = renderCard({ isTaskCompleted: () => true });
    expect(screen.getByText('Done!')).toBeInTheDocument();
    allDone.unmount();

    const preview = renderCard({
      routine: { ...routine, tasks: [] },
      label: 'Tomorrow',
      onEdit: undefined,
      onDelete: undefined,
    });
    expect(screen.getByText('Tomorrow')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Actions: School mornings' }),
    ).not.toBeInTheDocument();
    preview.unmount();

    renderCard({ routine: { ...routine, tasks: [] }, onEdit: undefined, onDelete: undefined });
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });
});

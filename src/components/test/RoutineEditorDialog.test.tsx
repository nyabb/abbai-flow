import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nContext, createI18n } from '../../i18n';
import type { FamilyMember, Routine } from '../../types/family';
import { RoutineEditorDialog } from '../routines/RoutineEditorDialog';

const mocks = vi.hoisted(() => ({
  addRoutine: vi.fn(),
  updateRoutine: vi.fn(),
}));

vi.mock('../../hooks/useRoutines', () => ({
  useRoutines: () => ({
    addRoutine: mocks.addRoutine,
    updateRoutine: mocks.updateRoutine,
  }),
}));

const i18n = createI18n('en');
const CHILD: FamilyMember = {
  id: 'child-1',
  name: 'Zara',
  avatar: '🧒',
  color: '#cf6d55',
  role: 'child',
};
const PARENT: FamilyMember = {
  id: 'parent-1',
  name: 'Papa',
  avatar: '👨',
  color: '#1f7a5a',
  role: 'parent',
};

function renderEditor({
  request = { token: 1 },
  members = [CHILD, PARENT],
  onClose = vi.fn(),
  onSaved = vi.fn(),
}: {
  request?: { token: number; memberId?: string; routine?: Routine };
  members?: FamilyMember[];
  onClose?: () => void;
  onSaved?: () => void | Promise<void>;
} = {}) {
  const result = render(
    <I18nContext.Provider value={i18n}>
      <RoutineEditorDialog
        request={request}
        members={members}
        locale="en"
        weekStartsOn={1}
        onClose={onClose}
        onSaved={onSaved}
      />
    </I18nContext.Provider>,
  );
  return { ...result, onClose, onSaved };
}

beforeEach(() => {
  mocks.addRoutine.mockReset().mockResolvedValue(undefined);
  mocks.updateRoutine.mockReset().mockResolvedValue(undefined);
});

describe('RoutineEditorDialog', () => {
  it('creates a routine for the selected parent without a points field', async () => {
    const { onClose, onSaved } = renderEditor();
    const dialog = screen.getByRole('dialog');
    const saveButton = within(dialog).getByRole('button', { name: 'Save Routine' });
    expect(saveButton).toBeDisabled();

    const assignees = within(dialog).getByRole('group', { name: 'For whom' });
    fireEvent.click(within(assignees).getByRole('button', { name: 'Papa' }));
    expect(within(assignees).getByRole('button', { name: 'Papa' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(assignees).getByRole('button', { name: 'Zara' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Evening reset' },
    });
    fireEvent.change(within(dialog).getByPlaceholderText('Task 1 (e.g. Brush teeth)'), {
      target: { value: 'Prepare lunches' },
    });

    expect(within(dialog).queryByText('Mission points')).not.toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mocks.addRoutine).toHaveBeenCalledWith({
        name: 'Evening reset',
        member_id: PARENT.id,
        time_of_day: 'morning',
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        mission_points: 0,
        tasks: [expect.objectContaining({ name: 'Prepare lunches', order: 0 })],
      }),
    );
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('edits the routine, schedule, point bonus, and ordered task list', async () => {
    const routine: Routine = {
      id: 'routine-1',
      name: 'School mornings',
      member_id: CHILD.id,
      time_of_day: 'morning',
      days_of_week: [1, 3],
      mission_points: 6,
      tasks: [
        { id: 'task-b', name: 'Pack bag', order: 1 },
        { id: 'task-a', name: 'Get dressed', order: 0 },
      ],
    };
    renderEditor({ request: { token: 2, routine, memberId: CHILD.id } });
    const dialog = screen.getByRole('dialog');
    const days = within(dialog).getByRole('group', { name: 'Repeat on' });

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'School mornings updated' },
    });
    fireEvent.change(within(dialog).getByLabelText('Time of Day'), {
      target: { value: 'evening' },
    });
    fireEvent.change(within(dialog).getByDisplayValue('6'), { target: { value: '7' } });
    fireEvent.click(within(days).getByRole('button', { name: 'Tuesday' }));
    fireEvent.click(within(dialog).getAllByLabelText('Move down')[0]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Routine' }));

    await waitFor(() =>
      expect(mocks.updateRoutine).toHaveBeenCalledWith('routine-1', {
        name: 'School mornings updated',
        time_of_day: 'evening',
        days_of_week: [1, 2, 3],
        mission_points: 7,
        tasks: [
          { id: 'task-b', name: 'Pack bag', order: 0 },
          { id: 'task-a', name: 'Get dressed', order: 1 },
        ],
      }),
    );
  });

  it('keeps a routine on at least one weekday and reports a save failure', async () => {
    const routine: Routine = {
      id: 'routine-1',
      name: 'One day routine',
      member_id: CHILD.id,
      time_of_day: 'morning',
      days_of_week: [1],
      mission_points: 5,
      tasks: [{ id: 'task-a', name: 'Pack bag', order: 0 }],
    };
    mocks.updateRoutine.mockRejectedValueOnce(new Error('Storage unavailable'));
    const { onClose } = renderEditor({ request: { token: 3, routine } });
    const dialog = screen.getByRole('dialog');
    const monday = within(dialog)
      .getByRole('group', { name: 'Repeat on' })
      .querySelector<HTMLButtonElement>('[aria-label="Monday"]')!;
    fireEvent.click(monday);
    expect(monday).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Routine' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Storage unavailable');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes with Escape and disables save when no members are available', () => {
    const { onClose } = renderEditor({ members: [] });
    expect(screen.getByRole('button', { name: 'Save Routine' })).toBeDisabled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

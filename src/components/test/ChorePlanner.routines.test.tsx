import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChorePlanner } from '../ChorePlanner';
import { I18nContext, createI18n } from '../../i18n';
import type { FamilyMember, Routine } from '../../types/family';
import type { ChoresManState } from '../../types/choresman';

const mocks = vi.hoisted(() => ({
  state: { current: null as ChoresManState | null },
  adjustPoints: vi.fn(async () => {}),
  runActionId: vi.fn(async () => {}),
  createChore: vi.fn(async () => {}),
  updateChore: vi.fn(async () => {}),
  deleteChore: vi.fn(async () => {}),
}));

vi.mock('../../hooks/useChoresMan', () => ({
  useChoresMan: () => ({
    data: mocks.state.current,
    loading: false,
    error: null,
    available: true,
    refresh: async () => {},
    runActionId: mocks.runActionId,
    claimChore: async () => {},
    createChore: mocks.createChore,
    updateChore: mocks.updateChore,
    createReward: async () => {},
    updateReward: async () => {},
    deleteReward: async () => {},
    deleteChore: mocks.deleteChore,
    approveReward: async () => {},
    adjustPoints: mocks.adjustPoints,
  }),
}));

const NL = createI18n('nl');
const PARENT: FamilyMember = {
  id: 'parent-1',
  name: 'Papa',
  avatar: '👨',
  color: '#10b981',
  role: 'parent',
};
const CHILD: FamilyMember = {
  id: 'child-1',
  name: 'Zara',
  avatar: '🧒',
  color: '#cf6d55',
  role: 'child',

};

function choresManState(): ChoresManState {
  return {
    users: [
      {
        name: 'Zara',
        slug: 'zara',
        points: 10,
        dueToday: 0,
        claimed: 0,
        approved: 0,
        completedToday: 0,
      },
    ],
    chores: [
      {
        id: 'old-routine-chore',
        plannerRowId: 'choresman-row:legacy-routine-chore:zara',
        name: 'Legacy task',
        icon: null,
        status: 'pending',
        assignee: 'Zara',
        assignedUserNames: ['Zara'],
        completionCriteria: 'independent',
        points: 1,
        dueDate: null,
        canClaim: true,
        canApprove: false,
        frequency: 'daily',
        labels: ['Old ChoresMan routine'],
        actions: { claim: 'choresman-action:claim-legacy-task' },
      },
    ],
    rewards: [],
    people: [],
    pointsByUser: { zara: 10 },
    pendingApprovals: { chores: 0, rewards: 0 },
    entryId: 'entry-1',
    available: true,
  };
}

function familyRoutine(memberId = CHILD.id, overrides: Partial<Routine> = {}): Routine {
  return {
    id: `routine-${memberId}`,
    name: memberId === PARENT.id ? 'Evening reset' : 'Morning routine',
    member_id: memberId,
    time_of_day: 'morning',
    mission_points: 5,
    tasks: [
      { id: 'task-1', name: 'Brush teeth', order: 0 },
      { id: 'task-2', name: 'Get dressed', order: 1 },
    ],
    ...overrides,
  };
}

function seedRoutines(...routines: Routine[]) {
  localStorage.setItem('abbai_flow_routines', JSON.stringify(routines));
}

function renderPlanner(members: FamilyMember[] = [PARENT, CHILD]) {
  return render(
    <I18nContext.Provider value={NL}>
      <ChorePlanner members={members} locale="nl" onLocaleChange={() => {}} />
    </I18nContext.Provider>,
  );
}

function column(container: HTMLElement, name: string): HTMLElement {
  return [...container.querySelectorAll<HTMLElement>('.planner-col')].find(
    (element) => element.querySelector('.planner-col-head strong')?.textContent === name,
  )!;
}

describe('Family routines in the chore planner', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 1, 8, 0));
    localStorage.clear();
    mocks.state.current = choresManState();
    mocks.adjustPoints.mockReset();
    mocks.runActionId.mockReset();
    mocks.createChore.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads routine definitions from Abbai Flow and keeps old ChoresMan labels as chores', async () => {
    seedRoutines(familyRoutine());
    const { container } = renderPlanner();

    const zara = column(container, 'Zara');
    await waitFor(() => expect(zara.querySelector('.planner-row--routine')).not.toBeNull());
    const routine = zara.querySelector<HTMLElement>('.planner-row--routine')!;
    expect(routine.textContent).toContain('Morning routine');
    expect(routine.querySelector('.planner-steps')?.textContent).toContain('Brush teeth');
    expect(zara.textContent).toContain('Legacy task');
    expect(zara.querySelectorAll('.planner-row--routine')).toHaveLength(1);
    expect(mocks.createChore).not.toHaveBeenCalled();
  });

  it('saves direct step checkoffs in Abbai Flow without an approval or chore service call', async () => {
    seedRoutines(familyRoutine());
    const { container } = renderPlanner();
    const zara = column(container, 'Zara');

    const checkoff = await waitFor(() => {
      const button = zara.querySelector<HTMLButtonElement>('.planner-step-action');
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(checkoff);

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('abbai_flow_routine_completions') ?? '[]');
      expect(saved).toEqual([
        expect.objectContaining({ routine_id: 'routine-child-1', task_id: 'task-1' }),
      ]);
    });
    expect(mocks.runActionId).not.toHaveBeenCalled();
    expect(mocks.adjustPoints).not.toHaveBeenCalled();
  });

  it('awards the editable routine bonus through ChoresMan only after a child mission finishes', async () => {
    seedRoutines(
      familyRoutine(CHILD.id, {
        mission_points: 8,
        tasks: [{ id: 'last-task', name: 'Pack school bag', order: 0 }],
      }),
    );
    const { container } = renderPlanner();
    const zara = column(container, 'Zara');

    const start = await waitFor(() => {
      const button = zara.querySelector<HTMLButtonElement>('.planner-row-start');
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(start);
    fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-mission-done')!);

    await waitFor(() => expect(mocks.adjustPoints).toHaveBeenCalledTimes(1));
    expect(mocks.adjustPoints).toHaveBeenCalledWith(
      'Zara',
      8,
      expect.stringContaining('Abbai Flow mission: Morning routine'),
    );
    expect(mocks.runActionId).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem('abbai_flow_routine_mission_awards') ?? '[]'),
    ).toHaveLength(1);
  });

  it('keeps each mission attached to one selected routine when a child has several', async () => {
    seedRoutines(
      familyRoutine(CHILD.id, {
        id: 'routine-first',
        name: 'Before school',
        mission_points: 4,
        tasks: [{ id: 'first-task', name: 'Make the bed', order: 0 }],
      }),
      familyRoutine(CHILD.id, {
        id: 'routine-second',
        name: 'Pack up',
        mission_points: 7,
        tasks: [{ id: 'second-task', name: 'Pack the bag', order: 0 }],
      }),
    );
    const { container } = renderPlanner();
    const zara = column(container, 'Zara');
    const startRoutineLabel = NL.t('planner.startRoutine');

    await waitFor(() => expect(zara.querySelectorAll('.planner-row--routine')).toHaveLength(2));
    fireEvent.click(zara.querySelector<HTMLButtonElement>('.planner-col-play')!);
    expect(
      screen.getByRole('button', { name: `${startRoutineLabel}: Before school` }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: `${startRoutineLabel}: Pack up` })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: `${startRoutineLabel}: Pack up` }));
    expect(container.querySelector('.planner-mission-routine')?.textContent).toContain('Pack up');
    expect(container.querySelector('.planner-mission-hero')?.textContent).toContain('Pack the bag');

    fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-mission-done')!);
    await waitFor(() => expect(mocks.adjustPoints).toHaveBeenCalledTimes(1));
    expect(mocks.adjustPoints).toHaveBeenCalledWith(
      'Zara',
      7,
      expect.stringContaining('Abbai Flow mission: Pack up'),
    );
    expect(JSON.parse(localStorage.getItem('abbai_flow_routine_completions') ?? '[]')).toEqual([
      expect.objectContaining({ routine_id: 'routine-second', task_id: 'second-task' }),
    ]);
  });

  it('releases the bonus reservation when ChoresMan rejects a mission award', async () => {
    mocks.adjustPoints.mockRejectedValueOnce(new Error('ChoresMan unavailable'));
    seedRoutines(
      familyRoutine(CHILD.id, {
        id: 'routine-failed-award',
        tasks: [{ id: 'last-task', name: 'Pack school bag', order: 0 }],
      }),
    );
    const { container } = renderPlanner();
    const zara = column(container, 'Zara');

    const start = await waitFor(() => {
      const button = zara.querySelector<HTMLButtonElement>('.planner-row-start');
      expect(button).not.toBeNull();
      return button!;
    });
    fireEvent.click(start);
    fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-mission-done')!);

    await waitFor(() => expect(mocks.adjustPoints).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('abbai_flow_routine_mission_awards') ?? '[]')).toEqual(
        [],
      );
    });
  });

  it('shows each routine only on its selected weekdays', async () => {
    const tomorrow = (new Date().getDay() + 1) % 7;
    seedRoutines(familyRoutine(CHILD.id, { days_of_week: [tomorrow] }));
    const { container } = renderPlanner();

    await waitFor(() => expect(localStorage.getItem('abbai_flow_routines')).not.toBeNull());
    expect(column(container, 'Zara').querySelector('.planner-row--routine')).toBeNull();
  });

  it('does not allow a morning routine to be checked off in the evening', async () => {
    vi.setSystemTime(new Date(2024, 0, 1, 20, 0));
    seedRoutines(familyRoutine());
    const { container } = renderPlanner();
    const zara = column(container, 'Zara');

    const row = await waitFor(() => {
      const found = zara.querySelector<HTMLElement>('.planner-row--routine');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(row.querySelector('.planner-step-action')).toBeNull();
    expect(row.querySelector<HTMLButtonElement>('.planner-row-start')).toBeDisabled();
    expect(zara.querySelector<HTMLButtonElement>('.planner-col-play')).toBeDisabled();
  });

  it('gives parents a routine-only page and includes them in the member filter', async () => {
    seedRoutines(
      familyRoutine(PARENT.id, {
        name: 'Kitchen reset',
        mission_points: 12,
        tasks: [{ id: 'parent-task', name: 'Clear the counter', order: 0 }],
      }),
    );
    const { container } = renderPlanner();

    const papa = await waitFor(() => {
      const found = column(container, 'Papa');
      expect(found.querySelector('.planner-row--routine')).not.toBeNull();
      return found;
    });
    expect(papa.textContent).toContain('Clear the counter');
    expect(papa.querySelector('.planner-col-points')).toBeNull();
    expect(papa.querySelector('.planner-col-play')).toBeNull();
    expect(papa.querySelector('.planner-row-start')).toBeNull();
    expect(papa.textContent).not.toContain('12');

    fireEvent.click(papa.querySelector<HTMLButtonElement>('.planner-col-open')!);
    const detail = container.querySelector<HTMLElement>('.planner-detail')!;
    expect(detail.querySelectorAll('.planner-detail-section')).toHaveLength(1);
    expect(detail.querySelector('.planner-col-play')).toBeNull();
    expect(detail.querySelector('.planner-row-start')).toBeNull();
    expect(detail.textContent).toContain('Clear the counter');
    expect(detail.textContent).not.toContain('Doelen');
    expect(detail.textContent).not.toContain('Taakjes');

    fireEvent.click(
      container.querySelector<HTMLButtonElement>('.planner-header .planner-icon-button')!,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Filteren"]')!);
    const filter = container.querySelector<HTMLElement>('.planner-sheet')!;
    expect(within(filter).getByRole('button', { name: /Papa/ })).toBeInTheDocument();
  });

  it('opens the shared editor from a routine row and saves the edit in place', async () => {
    seedRoutines(familyRoutine());
    const { container } = renderPlanner();
    await waitFor(() =>
      expect(column(container, 'Zara').querySelector('.planner-row--routine')).not.toBeNull(),
    );

    fireEvent.click(
      screen.getByRole('button', { name: `${NL.t('planner.action')}: Morning routine` }),
    );
    fireEvent.click(
      screen.getByRole('menuitem', {
        name: NL.t('settings.family.editRoutine', { name: 'Morning routine' }),
      }),
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    fireEvent.change(
      within(dialog).getByPlaceholderText(NL.t('settings.family.routineNamePlaceholder')),
      { target: { value: 'Updated morning' } },
    );
    fireEvent.click(within(dialog).getByText(NL.t('settings.family.saveRoutine')));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('abbai_flow_routines') ?? '[]')).toEqual([
        expect.objectContaining({ id: 'routine-child-1', name: 'Updated morning' }),
      ]);
    });
    expect(column(container, 'Zara').textContent).toContain('Updated morning');
  });

  it('deletes a routine from the task list dropdown after confirmation', async () => {
    seedRoutines(familyRoutine());
    const { container } = renderPlanner();
    await waitFor(() =>
      expect(column(container, 'Zara').querySelector('.planner-row--routine')).not.toBeNull(),
    );

    fireEvent.click(
      screen.getByRole('button', { name: `${NL.t('planner.action')}: Morning routine` }),
    );
    const deleteAction = screen.getByRole('menuitem', {
      name: NL.t('settings.family.deleteRoutine', { name: 'Morning routine' }),
    });
    fireEvent.click(deleteAction);
    expect(JSON.parse(localStorage.getItem('abbai_flow_routines') ?? '[]')).toHaveLength(1);
    fireEvent.click(deleteAction);

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('abbai_flow_routines') ?? '[]')).toEqual([]),
    );
    expect(column(container, 'Zara').querySelector('.planner-row--routine')).toBeNull();
  });

  it('opens the shared routine editor from the Chores add sheet', async () => {
    const { container } = renderPlanner();

    fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-add')!);
    fireEvent.click(screen.getByRole('button', { name: NL.t('planner.routineNew') }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('group', { name: NL.t('planner.forWho') })).getByRole('button', {
        name: CHILD.name,
      }),
    );
    fireEvent.change(screen.getByPlaceholderText(NL.t('settings.family.routineNamePlaceholder')), {
      target: { value: 'After school' },
    });
    fireEvent.change(
      screen.getByPlaceholderText(NL.t('settings.family.taskPlaceholder', { n: 1 })),
      { target: { value: 'Hang coat' } },
    );
    fireEvent.click(screen.getByText(NL.t('settings.family.saveRoutine')));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('abbai_flow_routines') ?? '[]')).toEqual([
        expect.objectContaining({ name: 'After school', member_id: CHILD.id }),
      ]);
    });
    expect(mocks.createChore).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChoresManState } from '../../types/choresman';
import type { FamilyMember, Routine } from '../../types/family';
import type { AbbaiSettings } from '../../hooks/useSettings';
import { FocusView } from '../focus/FocusView';

const mocks = vi.hoisted(() => ({
  members: [] as FamilyMember[],
  routines: [] as Routine[],
  chores: [] as ChoresManState['chores'],
  completedTaskIds: new Set<string>(),
  toggleTask: vi.fn(async () => true),
  removeRoutine: vi.fn(async () => true),
  refreshRoutines: vi.fn(async () => {}),
  refreshChores: vi.fn(async () => {}),
  runActionId: vi.fn(async () => {}),
}));

vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => ({ members: mocks.members }),
}));

vi.mock('../../hooks/useRoutines', () => ({
  useRoutines: () => ({
    routines: mocks.routines,
    isTaskCompletedToday: (_routineId: string, taskId: string) =>
      mocks.completedTaskIds.has(taskId),
    toggleTask: mocks.toggleTask,
    removeRoutine: mocks.removeRoutine,
    refresh: mocks.refreshRoutines,
  }),
}));

vi.mock('../../hooks/useChoresMan', () => ({
  useChoresMan: () => ({
    data: {
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
      chores: mocks.chores,
      rewards: [],
      people: [],
      pointsByUser: { zara: 10 },
      pendingApprovals: { chores: 0, rewards: 0 },
      entryId: 'entry-1',
      available: true,
    } satisfies ChoresManState,
    loading: false,
    error: null,
    refresh: mocks.refreshChores,
    runActionId: mocks.runActionId,
  }),
}));

vi.mock('../../hooks/useHaptics', () => ({
  hapticMedium: vi.fn(),
  hapticSuccess: vi.fn(),
}));

const child: FamilyMember = {
  id: 'child-1',
  name: 'Zara',
  avatar: '🧒',
  color: '#cf6d55',
  role: 'child',

};

const routine = (id: string, name: string): Routine => ({
  id,
  name,
  member_id: child.id,
  time_of_day: 'morning',
  days_of_week: [1, 2],
  tasks: [{ id: `${id}-task`, name: `${name} task`, order: 0 }],
});

const settings = {
  reducedMotion: false,
  timeFormat: '24h',
  currencySymbol: '€',
  screenSaverEnabled: false,
  dimTimeout: 5,
  screenSaverTimeout: 10,
  locale: 'en-US',
  weekStartsOn: 1,
} as AbbaiSettings;

describe('FocusView routines', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2024, 0, 1, 8, 0));
    mocks.members = [child];
    mocks.routines = [routine('routine-1', 'Before school'), routine('routine-2', 'Pack up')];
    mocks.chores = [];
    mocks.completedTaskIds = new Set();
    mocks.toggleTask.mockClear();
    mocks.removeRoutine.mockClear();
    mocks.runActionId.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows every routine in the current time block and locks them after it ends', async () => {
    const { container } = render(
      <FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />,
    );

    expect(container.querySelectorAll('.focus-card')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Complete Before school task' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Complete Pack up task' })).toBeEnabled();

    vi.setSystemTime(new Date(2024, 0, 1, 20, 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getAllByText('Tomorrow morning')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Complete Before school task' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Complete Pack up task' })).toBeDisabled();
  });

  it('lets the child check off an active routine task', () => {
    render(<FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete Before school task' }));
    expect(mocks.toggleTask).toHaveBeenCalledWith(mocks.routines[0], 'routine-1-task');
  });

  it('shows the celebration after every current routine task is complete', () => {
    mocks.completedTaskIds = new Set(['routine-1-task', 'routine-2-task']);

    render(<FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />);

    expect(screen.getByText('All done — great job!')).toBeInTheDocument();
  });

  it('shows an empty state when no routine is scheduled', () => {
    mocks.routines = [];

    render(<FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />);

    expect(screen.getByText(/Nothing scheduled yet/)).toBeInTheDocument();
  });

  it('opens the edit and delete actions for a routine', () => {
    const { container } = render(
      <FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />,
    );

    fireEvent.click(container.querySelector('.routine-actions-trigger')!);
    const menuItems = screen.getAllByRole('menuitem');
    fireEvent.click(menuItems[1]);
    fireEvent.click(screen.getAllByRole('menuitem')[1]);

    expect(mocks.removeRoutine).toHaveBeenCalledWith('routine-1');
  });

  it('opens the routine editor from the focus display', () => {
    const { container } = render(
      <FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />,
    );

    fireEvent.click(container.querySelector('.routine-actions-trigger')!);
    fireEvent.click(screen.getAllByRole('menuitem')[0]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks for confirmation before claiming a ChoresMan chore', async () => {
    mocks.chores = [
      {
        id: 'chore-1',
        name: 'Vacuum',
        icon: '🧹',
        status: 'open',
        assignee: 'Zara',
        points: 1,
        canClaim: true,
        canApprove: false,
        actions: { claim: 'choresman-action:claim' },
      },
    ];
    render(<FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete Vacuum' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(mocks.runActionId).toHaveBeenCalledWith('choresman-action:claim'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('celebrates after a parent approves a claimed ChoresMan chore', async () => {
    mocks.chores = [
      {
        id: 'chore-1',
        name: 'Vacuum',
        icon: null,
        status: 'in progress',
        assignee: 'Zara',
        points: 1,
        canClaim: false,
        canApprove: true,
        actions: { approve: 'choresman-action:approve' },
      },
    ];
    render(<FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete Vacuum' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Finish this chore?');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mocks.runActionId).toHaveBeenCalledWith('choresman-action:approve');
      expect(document.querySelectorAll('.planner-confetti--chore i')).toHaveLength(36);
    });
  });

  it('asks before exiting after five clock taps', () => {
    const onExit = vi.fn();
    render(<FocusView memberId={child.id} settings={settings} onExit={onExit} />);

    const clock = screen.getByRole('button', { name: 'Clock' });
    for (let tap = 0; tap < 5; tap += 1) fireEvent.click(clock);

    expect(screen.getByText(/Exit Zara’s display/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('renders nothing if the family member was removed', () => {
    mocks.members = [];

    const { container } = render(
      <FocusView memberId={child.id} settings={settings} onExit={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

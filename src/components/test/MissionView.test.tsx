import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlannerTask } from '../../api/chore-planner-model';
import type { PlannerCopy } from '../chore-planner/copy';
import { MissionView } from '../chore-planner/MissionView';
import type { Routine } from '../../types/family';

const copy = {
  missions: 'Missions',
  startRoutine: 'Start routine',
  noMissions: 'No more routines',
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  active: 'Active',
  late: 'Late',
  retryCopy: 'Try again soon',
  iDidIt: 'I did it',
  approveCompletion: 'Approve completion',
  todayEarned: 'Today earned',
  pot: 'Available',
  pass: 'Back',
} as PlannerCopy;

const routine = (id: string, time_of_day: Routine['time_of_day']): Routine =>
  ({ id, name: `Routine ${id}`, member_id: 'child-1', time_of_day, tasks: [] }) as Routine;

const task = (overrides: Partial<PlannerTask> = {}): PlannerTask =>
  ({ id: 'task-1', name: 'Brush teeth', points: 2, ...overrides }) as PlannerTask;

const commonProps = {
  member: { id: 'child-1', name: 'Zara' },
  copy,
  t: ((key: string, values?: Record<string, string | number>) =>
    key === 'planner.routineWindowHint'
      ? `Available in ${values?.time}`
      : key === 'planner.of'
        ? 'of'
        : key === 'planner.wellDone'
          ? `Well done, ${values?.name}`
          : key) as never,
  completedPoints: 12,
  spendable: 8,
  currentTask: null,
  currentStatus: 'active',
  index: 0,
  total: 1,
  countdown: '10m',
  online: true,
  busy: false,
  renderTask: (item: PlannerTask) => <span key={item.id}>{item.name}</span>,
  onStartRoutine: vi.fn(),
  onComplete: vi.fn(),
  onApprove: vi.fn(),
  onPass: vi.fn(),
};

describe('MissionView routine missions', () => {
  it('offers each routine separately with its time of day', () => {
    render(
      <MissionView
        {...commonProps}
        screen="missions"
        routines={[
          { routine: routine('morning', 'morning'), tasks: [task()] },
          { routine: routine('afternoon', 'afternoon'), tasks: [] },
          { routine: routine('evening', 'evening'), tasks: [] },
        ]}
      />,
    );

    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('Afternoon')).toBeInTheDocument();
    expect(screen.getByText('Evening')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start routine: Routine morning' }));
    expect(commonProps.onStartRoutine).toHaveBeenCalledWith('morning');
  });

  it('shows an empty state when no routines can be started', () => {
    render(<MissionView {...commonProps} screen="missions" routines={[]} />);

    expect(screen.getByText('No more routines')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Start routine/ })).not.toBeInTheDocument();
  });

  it('shows the routine window hint and keeps a late task disabled outside its window', () => {
    render(
      <MissionView
        {...commonProps}
        screen="mission"
        currentTask={task({ icon: '🪥' })}
        currentStatus="late"
        online={false}
        routineStep={{
          name: 'Afternoon routine',
          index: 2,
          total: 3,
          timeOfDay: 'afternoon',
          available: false,
        }}
      />,
    );

    expect(screen.getByText('Afternoon routine · 2/3')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Available in Afternoon');
    expect(screen.getByText('Late')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I did it' })).toBeDisabled();
  });

  it('offers parent approval for a task waiting for review', () => {
    render(
      <MissionView
        {...commonProps}
        screen="mission"
        currentTask={task({ awaitingReview: true })}
        currentStatus="retry"
        routineStep={null}
      />,
    );

    expect(screen.getByText('Try again soon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve completion' }));
    expect(commonProps.onApprove).toHaveBeenCalledOnce();
  });

  it('shows the earned and spendable points after a routine mission', () => {
    render(<MissionView {...commonProps} screen="closing" routines={[]} />);

    expect(screen.getByText('Well done, Zara')).toBeInTheDocument();
    expect(screen.getByText('Today earned: 12')).toBeInTheDocument();
    expect(screen.getByText('Available: 8')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(commonProps.onPass).toHaveBeenCalledOnce();
  });
});

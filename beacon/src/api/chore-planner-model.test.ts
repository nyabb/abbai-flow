import { describe, expect, it } from 'vitest';
import { getPlannerTaskStatus } from './chore-planner-model';
import type { PlannerTask } from './chore-planner-model';

function makeTask(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: 'task-1',
    name: 'Afwassen',
    icon: '✅',
    points: 3,
    memberId: 'member-1',
    kind: 'task',
    startsAt: '2026-11-06T09:00:00.000Z',
    deadlineAt: '2026-11-06T17:00:00.000Z',
    expiresAt: null,
    retryMinutes: null,
    timeBlock: 'custom',
    ...overrides,
  };
}

const NOW = new Date('2026-11-06T12:00:00.000Z');

describe('getPlannerTaskStatus', () => {
  it('uses the ChoreOps status when the task has one', () => {
    expect(getPlannerTaskStatus(makeTask({ statusOverride: 'late' }), NOW)).toBe('late');
    expect(getPlannerTaskStatus(makeTask({ statusOverride: 'completed' }), NOW)).toBe('completed');
  });

  it('reports completed for a task with a completion time', () => {
    expect(getPlannerTaskStatus(makeTask({ completedAt: '2026-11-06T11:00:00.000Z' }), NOW)).toBe(
      'completed',
    );
  });

  it('reports upcoming before the start time', () => {
    expect(getPlannerTaskStatus(makeTask({ startsAt: '2026-11-06T14:00:00.000Z' }), NOW)).toBe(
      'upcoming',
    );
  });

  it('reports late past the deadline and retry inside the grace window', () => {
    expect(getPlannerTaskStatus(makeTask({ deadlineAt: '2026-11-06T11:00:00.000Z' }), NOW)).toBe(
      'late',
    );
    expect(
      getPlannerTaskStatus(
        makeTask({ deadlineAt: '2026-11-06T11:00:00.000Z', retryMinutes: 120 }),
        NOW,
      ),
    ).toBe('retry');
  });

  it('reports expired for an unassigned task past its expiry', () => {
    expect(
      getPlannerTaskStatus(
        makeTask({
          memberId: null,
          deadlineAt: null,
          expiresAt: '2026-11-06T11:00:00.000Z',
        }),
        NOW,
      ),
    ).toBe('expired');
  });

  it('reports active while the deadline is still in the future', () => {
    expect(getPlannerTaskStatus(makeTask(), NOW)).toBe('active');
  });
});

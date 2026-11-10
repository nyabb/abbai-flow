import { describe, it, expect } from 'vitest';
import {
  DAY_KEYS,
  clockTime,
  countdown,
  emptyForm,
  formFromLiveTask,
  formFromTask,
  toastWith,
} from '../chore-planner/form';
import type { PlannerTask } from '../../api/chore-planner-model';

/**
 * The planner form conversions are the bridge between ChoreOps and the edit
 * screen: a wrong field here silently resets a chore's schedule or points when
 * somebody saves an unrelated change.
 */

const UNITS = { hoursShort: 'u', minutesShort: 'm' };

function makeTask(overrides: Partial<PlannerTask> = {}): PlannerTask {
  return {
    id: 'chore-1',
    name: 'Afwassen',
    icon: '✅',
    points: 5,
    memberId: 'c1',
    kind: 'task',
    startsAt: '2026-01-02T08:00:00.000Z',
    deadlineAt: '2026-01-02T09:00:00.000Z',
    expiresAt: null,
    retryMinutes: null,
    timeBlock: 'morning',
    audience: 'member',
    ...overrides,
  } as PlannerTask;
}

describe('planner form helpers', () => {
  it('derives a form value from a task without inventing schedule data', () => {
    const form = formFromTask(makeTask());

    expect(form.name).toBe('Afwassen');
    expect(form.points).toBe(5);
    expect(form.memberIds).toEqual(['c1']);
    expect(form.free).toBe(false);
    // Nothing is known about the schedule yet, so it stays "none" for ChoreOps.
    expect(form.liveFrequency).toBe('none');
    expect(form.liveLabel).toBe('');
  });

  it('marks an unassigned task as free for anyone', () => {
    const form = formFromTask(makeTask({ memberId: null }));
    expect(form.free).toBe(true);
    expect(form.memberIds).toEqual([]);
  });

  it('prefills the edit form from the ChoreOps chore', () => {
    const form = formFromLiveTask(makeTask(), {
      id: 'x',
      name: 'Afwassen',
      icon: null,
      status: 'pending',
      assignee: 'Zara',
      points: 12,
      canClaim: true,
      canApprove: false,
      frequency: 'weekly',
      applicableDays: ['mon', 'wed'],
      windowOffset: '0d 1h 0m',
      autoApprove: true,
      description: 'Keuken',
      labels: ['Ochtendroutine'],
      dueDate: '2026-02-03T10:00:00.000Z',
      actions: {},
    } as never);

    expect(form.points).toBe(12);
    expect(form.liveFrequency).toBe('weekly');
    // ChoreOps day keys map onto planner weekday indexes (Monday = 0).
    expect(form.liveWeekdays).toEqual([0, 2]);
    expect(form.liveWindow).toBe('1h');
    expect(form.liveAutoApprove).toBe(true);
    expect(form.liveDescription).toBe('Keuken');
    expect(form.liveLabel).toBe('Ochtendroutine');
    expect(DAY_KEYS[form.liveWeekdays[1]]).toBe('wed');
  });

  it('creates an empty form anchored on the given day', () => {
    const form = emptyForm(new Date('2026-03-04T12:00:00.000Z'));
    expect(form.name).toBe('');
    expect(form.free).toBe(false);
    expect(form.liveReminder).toBe('');
    expect(form.liveLabel).toBe('');
  });

  it('formats clock times and countdowns with the copy units', () => {
    expect(clockTime(new Date('2026-01-02T10:30:00Z'), 'en-GB')).toMatch(/\d{2}:\d{2}/);
    expect(countdown(null, new Date(), UNITS)).toBe('');
    expect(countdown('2026-01-02T12:00:00Z', new Date('2026-01-02T10:30:00Z'), UNITS)).toBe(
      '1u 30m',
    );
  });

  it('builds the toast text as action · subject', () => {
    expect(toastWith('Afgerond', 'Afwassen')).toBe('Afgerond · Afwassen');
  });
});

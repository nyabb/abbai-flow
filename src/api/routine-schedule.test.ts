import { describe, expect, it } from 'vitest';
import { getTimeOfDay, routineAvailableAt, routineOccursOnDate } from './routine-schedule';
import type { Routine } from '../types/family';

const routine = (days_of_week?: number[]): Routine => ({
  id: 'routine-1',
  name: 'Reading',
  member_id: 'member-1',
  time_of_day: 'evening',
  ...(days_of_week ? { days_of_week } : {}),
  tasks: [],
});

describe('routineOccursOnDate', () => {
  it('keeps routines without a schedule recurring every day', () => {
    expect(routineOccursOnDate(routine(), new Date(2024, 0, 2))).toBe(true);
  });

  it('treats an empty or all-week selection as daily', () => {
    const monday = new Date(2024, 0, 1);
    expect(routineOccursOnDate(routine([]), monday)).toBe(true);
    expect(routineOccursOnDate(routine([0, 1, 2, 3, 4, 5, 6]), monday)).toBe(true);
  });

  it('runs on every selected weekday and stays hidden on the others', () => {
    const monday = new Date(2024, 0, 1);
    const tuesday = new Date(2024, 0, 2);
    const wednesday = new Date(2024, 0, 3);
    const mondayAndWednesday = routine([1, 3]);

    expect(routineOccursOnDate(mondayAndWednesday, monday)).toBe(true);
    expect(routineOccursOnDate(mondayAndWednesday, tuesday)).toBe(false);
    expect(routineOccursOnDate(mondayAndWednesday, wednesday)).toBe(true);
  });
});

describe('routineAvailableAt', () => {
  it('opens each routine only in its matching local time block', () => {
    const morning = { ...routine([2]), time_of_day: 'morning' as const };
    const afternoon = { ...routine([2]), time_of_day: 'afternoon' as const };
    const evening = { ...routine([2]), time_of_day: 'evening' as const };
    const morningTime = new Date(2024, 0, 2, 11, 59);
    const noon = new Date(2024, 0, 2, 12, 0);
    const eveningTime = new Date(2024, 0, 2, 17, 0);

    expect(getTimeOfDay(morningTime)).toBe('morning');
    expect(getTimeOfDay(noon)).toBe('afternoon');
    expect(getTimeOfDay(eveningTime)).toBe('evening');
    expect(routineAvailableAt(morning, morningTime)).toBe(true);
    expect(routineAvailableAt(morning, eveningTime)).toBe(false);
    expect(routineAvailableAt(afternoon, noon)).toBe(true);
    expect(routineAvailableAt(afternoon, morningTime)).toBe(false);
    expect(routineAvailableAt(evening, eveningTime)).toBe(true);
    expect(routineAvailableAt(evening, noon)).toBe(false);
  });

  it('keeps a routine unavailable when its weekday schedule does not match', () => {
    expect(routineAvailableAt(routine([3]), new Date(2024, 0, 2, 8, 0))).toBe(false);
  });
});

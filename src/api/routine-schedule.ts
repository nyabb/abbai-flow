import type { Routine } from '../types/family';

export type RoutineTimeOfDay = Routine['time_of_day'];

/** morning < 12:00, afternoon 12:00–16:59, evening >= 17:00 (local time). */
export function getTimeOfDay(date: Date): RoutineTimeOfDay {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** Days use JavaScript's local weekday numbering: Sunday = 0 through Saturday = 6. */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Old routines without a weekday list continue to run every day. */
export function routineOccursOnDate(routine: Routine, date: Date = new Date()): boolean {
  const days = routine.days_of_week;
  if (!days || days.length === 0 || days.length >= 7) return true;
  return days.includes(date.getDay());
}

/** Whether this routine is scheduled for the current local day and time block. */
export function routineAvailableAt(routine: Routine, date: Date = new Date()): boolean {
  return routineOccursOnDate(routine, date) && routine.time_of_day === getTimeOfDay(date);
}

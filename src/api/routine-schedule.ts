import type { Routine } from '../types/family';

/** Days use JavaScript's local weekday numbering: Sunday = 0 through Saturday = 6. */
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Old routines without a weekday list continue to run every day. */
export function routineOccursOnDate(routine: Routine, date: Date = new Date()): boolean {
  const days = routine.days_of_week;
  if (!days || days.length === 0 || days.length >= 7) return true;
  return days.includes(date.getDay());
}

import { Routine } from '../../types/family';
import { getTimeOfDay, routineOccursOnDate } from '../../api/routine-schedule';

export { getTimeOfDay };

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

const ORDER: TimeOfDay[] = ['morning', 'afternoon', 'evening'];

export interface RoutinePick {
  routine: Routine;
  isCurrent: boolean;
  /** empty when current; otherwise e.g. "This afternoon", "Tonight", "Tomorrow morning" */
  label: string;
}

const PREVIEW_LABELS: Record<TimeOfDay, string> = {
  morning: 'This morning',
  afternoon: 'This afternoon',
  evening: 'Tonight',
};

/**
 * Show every routine in the current period. If none is scheduled now, preview
 * the next period that has routines, wrapping evening -> tomorrow morning.
 */
export function pickRoutines(routines: Routine[], now: Date): RoutinePick[] {
  if (routines.length === 0) return [];
  const startIdx = ORDER.indexOf(getTimeOfDay(now));
  for (let offset = 0; offset < ORDER.length; offset++) {
    const absoluteIdx = startIdx + offset;
    const idx = absoluteIdx % ORDER.length;
    const period = ORDER[idx];
    const scheduledDate = new Date(now);
    scheduledDate.setDate(scheduledDate.getDate() + Math.floor(absoluteIdx / ORDER.length));
    const scheduled = routines.filter(
      (routine) => routine.time_of_day === period && routineOccursOnDate(routine, scheduledDate),
    );
    if (scheduled.length === 0) continue;
    const isCurrent = offset === 0;
    const wrapped = absoluteIdx >= ORDER.length;
    const label = isCurrent ? '' : wrapped ? `Tomorrow ${period}` : PREVIEW_LABELS[period];
    return scheduled.map((routine) => ({ routine, isCurrent, label }));
  }
  return [];
}

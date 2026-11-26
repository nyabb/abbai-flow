import { addDays, addMonths, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import type { ChoresManChore } from '../types/choresman';
import type { FamilyMember } from '../types/family';
import type { CalendarEvent, CalendarInfo } from '../types';
import { resolveCalendarColor } from '../types';
import { resolveMemberForUser } from './chore-model';

export const CHORESMAN_CALENDAR_PREFIX = 'choresman:';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function dateOnly(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = parseISO(value);
  return isValid(date) ? date : null;
}

function clampMonthDate(date: Date, months: number): Date {
  // date-fns addMonths clamps to the last day of the target month, matching
  // ChoresMan's recurrence behavior for dates such as the 31st.
  return addMonths(date, months);
}

function nextOccurrence(chore: ChoresManChore, after: Date): Date | null {
  const frequency = chore.frequency || 'none';
  if (frequency === 'daily' || frequency === 'daily_multi') return addDays(after, 1);
  if (frequency === 'weekly') {
    const weekdays = (chore.applicableDays ?? []).map((day) => day.toLowerCase());
    if (weekdays.length === 0) return addDays(after, 7);
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addDays(after, offset);
      if (weekdays.includes(WEEKDAY_KEYS[candidate.getDay()])) return candidate;
    }
    return null;
  }
  if (frequency === 'biweekly') return addDays(after, 14);
  if (frequency === 'monthly') return clampMonthDate(after, 1);
  if (frequency === 'quarterly') return clampMonthDate(after, 3);
  if (frequency === 'yearly') return clampMonthDate(after, 12);
  if (
    frequency === 'custom' ||
    frequency === 'custom_from_complete' ||
    frequency === 'custom_from_complete_date_only'
  ) {
    const interval = Math.max(1, Number(chore.customInterval) || 1);
    switch (chore.customIntervalUnit) {
      case 'weeks':
        return addDays(after, interval * 7);
      case 'months':
        return clampMonthDate(after, interval);
      case 'hours':
        return addDays(after, Math.max(1, Math.ceil(interval / 24)));
      default:
        return addDays(after, interval);
    }
  }
  if (frequency === 'week_end') return addDays(after, after.getDay() === 0 ? 7 : 7 - after.getDay());
  if (frequency === 'month_end') {
    const endOfMonth = new Date(after.getFullYear(), after.getMonth() + 1, 0);
    return endOfMonth <= after
      ? new Date(after.getFullYear(), after.getMonth() + 2, 0)
      : endOfMonth;
  }
  if (frequency === 'quarter_end') {
    const quarterEnd = new Date(after.getFullYear(), Math.floor(after.getMonth() / 3) * 3 + 3, 0);
    return quarterEnd <= after
      ? new Date(after.getFullYear(), Math.floor(after.getMonth() / 3) * 3 + 6, 0)
      : quarterEnd;
  }
  if (frequency === 'year_end') {
    const yearEnd = new Date(after.getFullYear(), 11, 31);
    return yearEnd <= after ? new Date(after.getFullYear() + 1, 11, 31) : yearEnd;
  }
  return null;
}

function scheduledDates(chore: ChoresManChore, start: Date, end: Date): Date[] {
  const frequency = chore.frequency || 'none';
  const anchor = parseDate(chore.dueDate) ?? new Date();
  const startKey = dateOnly(start);
  const endKey = dateOnly(end);
  const result: Date[] = [];

  if (frequency === 'weekly' && (chore.applicableDays?.length ?? 0) > 0) {
    const selectedDays = new Set(chore.applicableDays!.map((day) => day.toLowerCase()));
    let cursor = new Date(Math.max(anchor.getTime(), start.getTime()));
    for (let count = 0; count < 400 && dateOnly(cursor) < endKey; count += 1, cursor = addDays(cursor, 1)) {
      if (dateOnly(cursor) >= startKey && selectedDays.has(WEEKDAY_KEYS[cursor.getDay()])) result.push(cursor);
    }
    return result;
  }

  let cursor = anchor;
  if (dateOnly(cursor) < startKey && frequency !== 'none') {
    const daysToStart = Math.max(0, differenceInCalendarDays(start, cursor));
    if (frequency === 'daily' || frequency === 'daily_multi') {
      cursor = addDays(cursor, daysToStart);
    } else if (frequency === 'biweekly') {
      cursor = addDays(cursor, Math.ceil(daysToStart / 14) * 14);
    } else if (frequency === 'weekly' && (chore.applicableDays?.length ?? 0) === 0) {
      cursor = addDays(cursor, Math.ceil(daysToStart / 7) * 7);
    } else if (frequency === 'custom' && chore.customIntervalUnit !== 'months') {
      const interval = Math.max(1, Number(chore.customInterval) || 1);
      const step = chore.customIntervalUnit === 'weeks'
        ? interval * 7
        : chore.customIntervalUnit === 'hours'
          ? Math.max(1, Math.ceil(interval / 24))
          : interval;
      cursor = addDays(cursor, Math.ceil(daysToStart / step) * step);
    } else {
      let count = 0;
      while (dateOnly(cursor) < startKey && count < 500) {
        const next = nextOccurrence(chore, cursor);
        if (!next || next <= cursor) break;
        cursor = next;
        count += 1;
      }
    }
  }

  for (let count = 0; cursor && dateOnly(cursor) < endKey && count < 400; count += 1) {
    if (dateOnly(cursor) >= startKey) result.push(cursor);
    const next = nextOccurrence(chore, cursor);
    if (!next || next <= cursor) break;
    cursor = next;
  }
  return result;
}

export function createChoresManCalendars(
  members: FamilyMember[],
  calendarColors?: Record<string, string>,
): CalendarInfo[] {
  return members
    .filter((member) => member.role === 'child')
    .map((member, index) => {
      const id = `${CHORESMAN_CALENDAR_PREFIX}${member.id}`;
      return {
        id,
        name: `${member.name} (ChoresMan)`,
        color: resolveCalendarColor(id, index, { calendarColors, defaultColor: member.color }),
        readOnly: true,
      };
    });
}

export function createChoresManCalendarEvents(
  chores: ChoresManChore[],
  members: FamilyMember[],
  calendars: CalendarInfo[],
  startValue: string,
  endValue: string,
): CalendarEvent[] {
  const start = parseDate(startValue);
  const end = parseDate(endValue);
  if (!start || !end || end <= start) return [];
  const calendarByMember = new Map(
    calendars.map((calendar) => [calendar.id.slice(CHORESMAN_CALENDAR_PREFIX.length), calendar]),
  );
  const today = new Date();

  return chores.flatMap((chore) => {
    if (chore.showOnCalendar === false || chore.status === 'completed_by_other') return [];
    const member = chore.assignee ? resolveMemberForUser(chore.assignee, members) : null;
    if (!member || member.role !== 'child') return [];
    const calendar = calendarByMember.get(member.id);
    if (!calendar) return [];

    // Chores without an explicit due date still have a schedule; anchor those
    // schedules to today so daily/weekly chores appear from now onward.
    const scheduledChore = chore.dueDate ? chore : { ...chore, dueDate: dateOnly(today) };
    return scheduledDates(scheduledChore, start, end).map((date) => {
      const day = dateOnly(date);
      return {
        id: `${CHORESMAN_CALENDAR_PREFIX}${chore.id}:${day}`,
        title: chore.name,
        start: day,
        end: dateOnly(addDays(date, 1)),
        allDay: true,
        description: chore.description || undefined,
        calendarId: calendar.id,
        calendarName: calendar.name,
        color: calendar.color,
        readOnly: true,
      };
    });
  });
}

/**
 * Planner form state, formatting helpers and the ChoreOps option tables.
 *
 * Everything here is pure: it converts a planner task into the editable form
 * value, converts a form value back through the payload builders, and formats
 * times with the app's locale. Keeping it out of the component means the
 * conversions can be reasoned about (and later tested) without a render.
 */
import { formatChoreOpsOffset } from '../../api/choreops';
import type { ChoreOpsFrequency, ChoreOpsIntervalUnit } from '../../api/choreops';
import type { PlannerTask } from '../../api/chore-planner-model';
import type { ChoreOpsChore } from '../../types/choreops';
import { type TranslationKey } from '../../i18n';
import type { PlannerCopy } from './copy';

/** Parent PINs must be at least this long to unlock approvals. */
export const MIN_PIN_LENGTH = 4;

/** Planner weekday indexes (Monday first) → ChoreOps day keys. */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** ChoreOps repeat options → dictionary keys, so the picker follows the app language. */
export const FREQUENCY_KEY: Record<ChoreOpsFrequency, TranslationKey> = {
  none: 'planner.freq.none',
  daily: 'planner.freq.daily',
  daily_multi: 'planner.freq.daily_multi',
  weekly: 'planner.freq.weekly',
  biweekly: 'planner.freq.biweekly',
  monthly: 'planner.freq.monthly',
  quarterly: 'planner.freq.quarterly',
  yearly: 'planner.freq.yearly',
  custom: 'planner.freq.custom',
  custom_from_complete: 'planner.freq.custom_from_complete',
  week_end: 'planner.freq.week_end',
  month_end: 'planner.freq.month_end',
  quarter_end: 'planner.freq.quarter_end',
  year_end: 'planner.freq.year_end',
};

/** Interval unit labels for `custom` repeats. */
export const UNIT_KEY: Record<ChoreOpsIntervalUnit, TranslationKey> = {
  hours: 'planner.unit.hours',
  days: 'planner.unit.days',
  weeks: 'planner.unit.weeks',
  months: 'planner.unit.months',
};

/** "Aangemaakt · Afwassen": the action first, then the chore it happened to. */
export function toastWith(action: string, label: string): string {
  return `${action} · ${label}`;
}

/** Editable snapshot of a chore, shared by the create and edit forms. */
export type FormValue = {
  name: string;
  icon: string;
  points: number;
  memberIds: string[];
  free: boolean;
  kind: 'task' | 'routine';
  monthlyDay: number;
  startsAt: string;
  deadlineAt: string;
  retry: boolean;
  grace: number;
  timeBlock: 'morning' | 'afternoon' | 'evening' | 'custom';
  customStart: string;
  customEnd: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'interval';
  interval: number;
  weekdays: number[];
  /** ChoreOps schedule — only read and written in live mode. */
  liveFrequency: ChoreOpsFrequency;
  liveInterval: number;
  liveIntervalUnit: ChoreOpsIntervalUnit;
  liveWeekdays: number[];
  /** Due window offset, e.g. `1h`; empty means "no window". */
  liveWindow: string;
  /** Reminder offset; empty means "leave the current reminder alone". */
  liveReminder: string;
  liveAutoApprove: boolean;
  liveDescription: string;
  /** First ChoreOps label: names the daily routine this chore belongs to. */
  liveLabel: string;
};

export function localDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** `10:30` in the app's locale — every clock time on the board goes through this. */
export function clockTime(value: Date | string, intl: string): string {
  return new Date(value).toLocaleTimeString(intl, { hour: '2-digit', minute: '2-digit' });
}

export function countdown(
  target: string | null,
  now: Date,
  copy: Pick<PlannerCopy, 'hoursShort' | 'minutesShort'>,
): string {
  if (!target) return '';
  const minutes = Math.max(0, Math.ceil((new Date(target).getTime() - now.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours}${copy.hoursShort} ` : ''}${rest}${copy.minutesShort}`;
}

export function formFromTask(task: PlannerTask): FormValue {
  return {
    name: task.name,
    icon: task.icon ?? '',
    points: task.points,
    memberIds: task.memberId ? [task.memberId] : [],
    free: !task.memberId,
    kind: task.kind,
    monthlyDay: new Date(task.startsAt).getDate(),
    startsAt: localDateTime(new Date(task.startsAt)),
    deadlineAt: localDateTime(
      new Date(task.deadlineAt ?? task.expiresAt ?? Date.now() + 3_600_000),
    ),
    retry: Boolean(task.retryMinutes),
    grace: task.retryMinutes ?? 60,
    timeBlock: task.timeBlock,
    customStart: task.customStart ?? '07:00',
    customEnd: task.customEnd ?? '11:59',
    frequency: 'daily',
    interval: 2,
    weekdays: [1, 2, 3, 4, 5],
    liveFrequency: 'none',
    liveInterval: 1,
    liveIntervalUnit: 'days',
    liveWeekdays: [0, 1, 2, 3, 4],
    liveWindow: '',
    liveReminder: '',
    liveAutoApprove: false,
    liveDescription: '',
    liveLabel: '',
  };
}

/** Prefill the edit form from the chore ChoreOps publishes. */
export function formFromLiveTask(task: PlannerTask, chore: ChoreOpsChore | null): FormValue {
  const base = formFromTask(task);
  const days = chore?.applicableDays ?? [];
  return {
    ...base,
    points: chore?.points ?? base.points,
    liveFrequency: (chore?.frequency as ChoreOpsFrequency | null) ?? 'none',
    liveWeekdays: days
      .map((day) => DAY_KEYS.indexOf(day as (typeof DAY_KEYS)[number]))
      .filter((index) => index >= 0),
    liveWindow: formatChoreOpsOffset(chore?.windowOffset),
    liveAutoApprove: chore?.autoApprove ?? false,
    liveDescription: chore?.description ?? '',
    liveLabel: chore?.labels?.[0] ?? '',
    deadlineAt: chore?.dueDate ? localDateTime(new Date(chore.dueDate)) : base.deadlineAt,
  };
}

export function emptyForm(now: Date): FormValue {
  return {
    name: '',
    icon: '✅',
    points: 5,
    memberIds: [],
    free: false,
    kind: 'task',
    monthlyDay: now.getDate(),
    startsAt: localDateTime(now),
    deadlineAt: localDateTime(new Date(now.getTime() + 3_600_000)),
    retry: false,
    grace: 60,
    timeBlock: 'morning',
    customStart: '07:00',
    customEnd: '11:59',
    frequency: 'daily',
    interval: 2,
    weekdays: [1, 2, 3, 4, 5],
    liveFrequency: 'none',
    liveInterval: 1,
    liveIntervalUnit: 'days',
    liveWeekdays: [0, 1, 2, 3, 4],
    liveWindow: '',
    liveReminder: '',
    liveAutoApprove: false,
    liveDescription: '',
    liveLabel: '',
  };
}

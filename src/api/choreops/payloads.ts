/**
 * ChoreOps service payloads: the schedules ChoreOps accepts, the create/update
 * builders for chores and rewards, and the formatting helpers the UI uses.
 *
 * Everything here is pure — it maps UI intent onto the documented service
 * arguments and back. Keeping it out of the entity normaliser means the payload
 * shape can be unit tested without fabricating a full HA state snapshot.
 */
import type { ChoreOpsChore, ChoreOpsUser } from '../../types/choreops';
import type { FamilyMember } from '../../types/family';
import { resolveMemberForUser } from './members';

/** Repeat options ChoreOps accepts on `choreops.create_chore` / `update_chore`. */
export const CHOREOPS_FREQUENCIES = [
  'none',
  'daily',
  'daily_multi',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
  'custom_from_complete',
  'week_end',
  'month_end',
  'quarter_end',
  'year_end',
] as const;

export type ChoreOpsFrequency = (typeof CHOREOPS_FREQUENCIES)[number];

/** Interval units ChoreOps accepts alongside `custom_interval`. */
export const CHOREOPS_INTERVAL_UNITS = ['hours', 'days', 'weeks', 'months'] as const;

export type ChoreOpsIntervalUnit = (typeof CHOREOPS_INTERVAL_UNITS)[number];

/** Weekday keys ChoreOps accepts in `applicable_days`. */
export const CHOREOPS_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type ChoreOpsWeekday = (typeof CHOREOPS_WEEKDAYS)[number];

/**
 * ChoreOps sentinel that resolves `assigned_user_names` to every assignable
 * user. This is how a chore becomes "free for anyone to claim": an empty
 * assignee list creates a *dormant* chore that publishes no entities at all,
 * so Abbai Flow would never see it.
 */
export const CHOREOPS_ALL_USERS = '*';

/** Completion rules ChoreOps accepts when a chore is created. */
export const CHOREOPS_COMPLETION_CRITERIA = ['independent', 'shared_first', 'shared_all'] as const;

export type ChoreOpsCompletionCriteria = (typeof CHOREOPS_COMPLETION_CRITERIA)[number];

export interface CreateChoreInput {
  /** ChoreOps config entry id from the system helper (`integration_entry_id`). */
  entryId: string | null;
  name: string;
  /**
   * ChoreOps user names, not Abbai Flow member names. At least one is required
   * unless the caller passes the `CHOREOPS_ALL_USERS` sentinel.
   */
  assignedUserNames: string[];
  /**
   * Create-only completion rule. Open-to-anyone chores use `shared_first`, so
   * the first person to complete it takes the points and the rest stop seeing
   * an open task.
   */
  completionCriteria?: ChoreOpsCompletionCriteria | null;
  points?: number | null;
  description?: string | null;
  /**
   * ChoreOps labels. Abbai Flow groups daily chores into routines by their first
   * label, so this is how a household names one ("Ochtendroutine").
   */
  labels?: string[] | null;
  frequency?: ChoreOpsFrequency | null;
  /** Only sent for `custom` frequency. */
  customInterval?: number | null;
  customIntervalUnit?: ChoreOpsIntervalUnit | null;
  /** Only sent for `weekly` frequency. */
  applicableDays?: ChoreOpsWeekday[];
  /** ISO date/time string understood by Home Assistant. */
  dueDate?: string | null;
  /** Due window offset, e.g. `1h`; `0` disables the window. */
  windowOffset?: string | null;
  /** Due reminder offset, e.g. `30m`. */
  reminderOffset?: string | null;
  /** Skip the parent approval step for this chore. */
  autoApprove?: boolean | null;
}

/**
 * Build the `choreops.create_chore` service payload.
 *
 * Only fields the user actually set are included, so ChoreOps keeps its own
 * defaults for everything else. Returns `null` when the input cannot produce a
 * valid chore (missing config entry, name, or assignees) — the service requires
 * `name` and `assigned_user_names`.
 */
export function buildCreateChorePayload(input: CreateChoreInput): Record<string, unknown> | null {
  const name = input.name.trim();
  const assignedUserNames = input.assignedUserNames
    .map((userName) => userName.trim())
    .filter((userName) => userName.length > 0);

  if (!input.entryId || !name || assignedUserNames.length === 0) return null;

  const payload: Record<string, unknown> = {
    config_entry_id: input.entryId,
    name,
    assigned_user_names: Array.from(new Set(assignedUserNames)),
  };

  if (input.completionCriteria) payload.completion_criteria = input.completionCriteria;
  if (typeof input.points === 'number' && Number.isFinite(input.points)) {
    payload.points = Math.max(0, Math.round(input.points));
  }
  if (input.description?.trim()) payload.description = input.description.trim();
  const createLabels = Array.from(
    new Set((input.labels ?? []).map((label) => label.trim()).filter(Boolean)),
  );
  if (createLabels.length > 0) payload.labels = createLabels;
  if (input.frequency) payload.frequency = input.frequency;

  if (input.frequency === 'custom' && input.customInterval) {
    payload.custom_interval = Math.max(1, Math.round(input.customInterval));
    if (input.customIntervalUnit) payload.custom_interval_unit = input.customIntervalUnit;
  }
  if (input.frequency === 'weekly' && input.applicableDays?.length) {
    payload.applicable_days = input.applicableDays.filter((day) => CHOREOPS_WEEKDAYS.includes(day));
  }
  if (input.dueDate) payload.due_date = input.dueDate;
  if (input.windowOffset !== undefined) {
    payload.due_window_offset = input.windowOffset?.trim() || '0';
  }
  if (input.reminderOffset?.trim()) payload.due_reminder_offset = input.reminderOffset.trim();
  if (typeof input.autoApprove === 'boolean') payload.auto_approve = input.autoApprove;

  return payload;
}

export interface UpdateChoreInput {
  /** ChoreOps config entry id from the system helper (`integration_entry_id`). */
  entryId: string | null;
  /**
   * The chore's current ChoreOps name. This is the only handle ChoreOps
   * publishes, so renames are not possible — the service needs the internal
   * chore id for that, which no entity attribute exposes.
   */
  name: string;
  /** Replaces the full assignee list when given. */
  assignedUserNames?: string[];
  points?: number;
  description?: string;
  /** Replaces the label list when given; drives the routines grouping. */
  labels?: string[];
  frequency?: string;
  customInterval?: number;
  customIntervalUnit?: ChoreOpsIntervalUnit;
  applicableDays?: string[];
  /** ISO date/time understood by Home Assistant. */
  dueDate?: string;
  /** Due window offset, e.g. `1h`, `1d 6h`, or `0` to disable. */
  windowOffset?: string;
  /** Due reminder offset; omitted means "leave the current reminder alone". */
  reminderOffset?: string;
  autoApprove?: boolean;
}

/**
 * Build the `choreops.update_chore` service payload.
 *
 * Only the fields the caller actually resolved are included, so editing one
 * property never resets the others. Returns `null` without a config entry or a
 * chore name, since ChoreOps needs one to find the chore.
 *
 * Note: ChoreOps rejects a schedule change with "The requested changes require
 * a future due date", so callers must send `dueDate` alongside `frequency`.
 */
export function buildUpdateChorePayload(input: UpdateChoreInput): Record<string, unknown> | null {
  const name = input.name.trim();
  if (!input.entryId || !name) return null;

  const payload: Record<string, unknown> = { config_entry_id: input.entryId, name };

  if (input.assignedUserNames) {
    const users = Array.from(
      new Set(input.assignedUserNames.map((userName) => userName.trim()).filter(Boolean)),
    );
    if (users.length > 0) {
      payload.assignment_action = 'replace';
      payload.assigned_user_names = users;
    }
  }
  if (typeof input.points === 'number' && Number.isFinite(input.points)) {
    payload.points = Math.max(0, Math.round(input.points));
  }
  if (input.description !== undefined) payload.description = input.description.trim();
  if (input.labels) {
    // An empty array is meaningful: it clears the labels (and with them the
    // routine grouping). Only a missing property means "leave them alone".
    payload.labels = Array.from(new Set(input.labels.map((label) => label.trim()).filter(Boolean)));
  }
  if (input.frequency) payload.frequency = input.frequency;

  if (
    input.customInterval &&
    (input.frequency === 'custom' || input.frequency === 'custom_from_complete')
  ) {
    payload.custom_interval = Math.max(1, Math.round(input.customInterval));
    if (input.customIntervalUnit) payload.custom_interval_unit = input.customIntervalUnit;
  }
  if (input.applicableDays?.length) {
    payload.applicable_days = input.applicableDays.filter((day): day is ChoreOpsWeekday =>
      CHOREOPS_WEEKDAYS.includes(day as ChoreOpsWeekday),
    );
  }
  if (input.dueDate) payload.due_date = input.dueDate;
  if (input.windowOffset !== undefined) {
    // An empty field means "no window"; ChoreOps spells that as `0`.
    payload.due_window_offset = input.windowOffset.trim() || '0';
  }
  if (input.reminderOffset?.trim()) payload.due_reminder_offset = input.reminderOffset.trim();
  if (typeof input.autoApprove === 'boolean') payload.auto_approve = input.autoApprove;

  return payload;
}

export interface CreateRewardInput {
  /** ChoreOps config entry id from the system helper (`integration_entry_id`). */
  entryId: string | null;
  name: string;
  /** Points needed to redeem it. */
  cost: number;
  /** ChoreOps user names — rewards are per user, so this is who can see it. */
  assignedUserNames: string[];
  description?: string | null;
}

/**
 * Build the `choreops.create_reward` payload.
 *
 * ChoreOps publishes one reward entity per user, so `assigned_user_names` is
 * what makes a reward belong to a specific child.
 */
export function buildCreateRewardPayload(input: CreateRewardInput): Record<string, unknown> | null {
  const name = input.name.trim();
  const users = Array.from(
    new Set(input.assignedUserNames.map((userName) => userName.trim()).filter(Boolean)),
  );
  if (!input.entryId || !name || users.length === 0) return null;

  const payload: Record<string, unknown> = {
    config_entry_id: input.entryId,
    name,
    cost: Math.max(1, Math.round(input.cost)),
    assigned_user_names: users,
  };
  if (input.description?.trim()) payload.description = input.description.trim();

  return payload;
}

export interface UpdateRewardInput {
  /** ChoreOps config entry id from the system helper (`integration_entry_id`). */
  entryId: string | null;
  /**
   * The reward's current name — the handle ChoreOps resolves it by. Renaming
   * needs the internal reward id, which no entity attribute exposes.
   */
  name: string;
  cost?: number;
}

/** Build the `choreops.update_reward` payload (price changes from the UI). */
export function buildUpdateRewardPayload(input: UpdateRewardInput): Record<string, unknown> | null {
  const name = input.name.trim();
  if (!input.entryId || !name) return null;

  const payload: Record<string, unknown> = { config_entry_id: input.entryId, name };
  if (typeof input.cost === 'number' && Number.isFinite(input.cost)) {
    payload.cost = Math.max(1, Math.round(input.cost));
  }

  return payload;
}

/**
 * Convert a ChoreOps offset string (`"0d 1h 0m"`, as the status sensor prints
 * it) into the compact form the services accept (`"1h"`).
 * Returns `""` when the offset is zero, which means "no window".
 */
export function formatChoreOpsOffset(raw: string | null | undefined): string {
  if (!raw) return '';
  const days = Number(/(\d+)\s*d/.exec(raw)?.[1] ?? 0);
  const hours = Number(/(\d+)\s*h/.exec(raw)?.[1] ?? 0);
  const minutes = Number(/(\d+)\s*m/.exec(raw)?.[1] ?? 0);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : '']
    .filter(Boolean)
    .join(' ');
}

export interface ChoreOpsChoreGroup {
  key: string;
  member: FamilyMember | null;
  label: string;
  chores: ChoreOpsChore[];
}

/** Group chores by ChoreOps user, retaining empty user columns and a shared group. */
export function groupChoreOpsChores(
  users: ChoreOpsUser[],
  chores: ChoreOpsChore[],
  members: FamilyMember[],
  sharedLabel: string,
): ChoreOpsChoreGroup[] {
  const groups = new Map<string, ChoreOpsChoreGroup>();
  const ensureGroup = (key: string, member: FamilyMember | null, label: string) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, member, label, chores: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const user of users) {
    const member = resolveMemberForUser(user.name, members);
    ensureGroup(
      member ? `member:${member.id}` : `user:${user.slug || user.name.trim().toLowerCase()}`,
      member,
      member?.name ?? user.name,
    );
  }

  for (const chore of chores) {
    const assignee = chore.assignee?.trim();
    if (!assignee) {
      ensureGroup('__shared__', null, sharedLabel).chores.push(chore);
      continue;
    }

    const user = users.find(
      (candidate) => candidate.name.trim().toLowerCase() === assignee.toLowerCase(),
    );
    const member = resolveMemberForUser(assignee, members);
    const key = member ? `member:${member.id}` : `user:${user?.slug || assignee.toLowerCase()}`;
    ensureGroup(key, member, member?.name ?? user?.name ?? assignee).chores.push(chore);
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.key === '__shared__') return 1;
    if (right.key === '__shared__') return -1;
    return left.label.localeCompare(right.label);
  });
}

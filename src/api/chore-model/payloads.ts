/**
 * ChoresMan service payloads: the schedules ChoresMan accepts, the create/update
 * builders for chores and rewards, and the formatting helpers the UI uses.
 *
 * Everything here is pure — it maps UI intent onto ChoresMan store actions.
 */
import type { ChoresManChore, ChoresManUser } from '../../types/choresman';
import type { FamilyMember } from '../../types/family';
import { resolveMemberForUser } from './members';

/** Repeat options ChoresMan accepts on `choresman.create_chore` / `update_chore`. */
export const CHORESMAN_FREQUENCIES = [
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
  'custom_from_complete_date_only',
  'week_end',
  'month_end',
  'quarter_end',
  'year_end',
] as const;

export type ChoresManFrequency = (typeof CHORESMAN_FREQUENCIES)[number];

/** Interval units ChoresMan accepts alongside `custom_interval`. */
export const CHORESMAN_INTERVAL_UNITS = ['hours', 'days', 'weeks', 'months'] as const;

export type ChoresManIntervalUnit = (typeof CHORESMAN_INTERVAL_UNITS)[number];

/** Weekday keys ChoresMan accepts in `applicable_days`. */
export const CHORESMAN_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export type ChoresManWeekday = (typeof CHORESMAN_WEEKDAYS)[number];

/**
 * ChoresMan sentinel that resolves `assigned_user_names` to every assignable
 * user. This is how a chore becomes "free for anyone to claim": an empty
 * assignee list creates a *dormant* chore with no assigned member rows,
 * so Abbai Flow would not show it on the family board.
 */
export const CHORESMAN_ALL_USERS = '*';

/** Completion rules ChoresMan accepts when a chore is created. */
export const CHORESMAN_COMPLETION_CRITERIA = ['independent', 'shared_first', 'shared_all'] as const;

export type ChoresManCompletionCriteria = (typeof CHORESMAN_COMPLETION_CRITERIA)[number];

export interface CreateChoreInput {
  name: string;
  /**
   * ChoresMan user names, not Abbai Flow member names. At least one is required
   * unless the caller passes the `CHORESMAN_ALL_USERS` sentinel.
   */
  assignedUserNames: string[];
  /**
   * Create-only completion rule. Open-to-anyone chores use `shared_first`, so
   * the first person to complete it takes the points and the rest stop seeing
   * an open task.
   */
  completionCriteria?: ChoresManCompletionCriteria | null;
  /** Existing icon and workflow policy when recreating an edited chore. */
  icon?: string | null;
  approvalReset?: string | null;
  pendingClaims?: string | null;
  overdueHandling?: string | null;
  claimLockUntilWindow?: boolean;
  notificationChannel?: string | null;
  notificationImportance?: string | null;
  notificationPriority?: string | null;
  notificationTtl?: number | null;
  showOnCalendar?: boolean;
  points?: number | null;
  description?: string | null;
  /** Ordinary chore labels. Abbai Flow routines are stored separately. */
  labels?: string[] | null;
  frequency?: ChoresManFrequency | null;
  /** Only sent for `custom` frequency. */
  customInterval?: number | null;
  customIntervalUnit?: ChoresManIntervalUnit | null;
  /** Only sent for `weekly` frequency. */
  applicableDays?: ChoresManWeekday[];
  /** ISO date/time string. */
  dueDate?: string | null;
  /** Due window offset, e.g. `1h`; `0` disables the window. */
  windowOffset?: string | null;
  /** Due reminder offset, e.g. `30m`. */
  reminderOffset?: string | null;
  /** Skip the parent approval step for this chore. */
  autoApprove?: boolean | null;
}

/**
 * Build the ChoresMan create chore payload.
 *
 * Only fields the user actually set are included, so ChoresMan keeps its own
 * defaults for everything else. Returns `null` when the input cannot produce a
 * valid chore (missing name or assignees).
 */
export function buildCreateChorePayload(input: CreateChoreInput): Record<string, unknown> | null {
  const name = input.name.trim();
  const assignedUserNames = input.assignedUserNames
    .map((userName) => userName.trim())
    .filter((userName) => userName.length > 0);

  if (!name || assignedUserNames.length === 0) return null;

  const payload: Record<string, unknown> = {
    name,
    assigned_user_names: Array.from(new Set(assignedUserNames)),
  };

  if (input.completionCriteria) payload.completion_criteria = input.completionCriteria;
  if (input.icon !== undefined) payload.icon = input.icon;
  if (input.approvalReset) payload.approval_reset_type = input.approvalReset;
  if (input.pendingClaims) payload.pending_claims = input.pendingClaims;
  if (input.overdueHandling) payload.overdue_handling = input.overdueHandling;
  if (typeof input.claimLockUntilWindow === 'boolean') {
    payload.chore_claim_lock_until_window = input.claimLockUntilWindow;
  }
  if (input.notificationChannel) payload.notification_channel = input.notificationChannel;
  if (input.notificationImportance) {
    payload.notification_importance = input.notificationImportance;
  }
  if (input.notificationPriority) payload.notification_priority = input.notificationPriority;
  if (typeof input.notificationTtl === 'number' && Number.isInteger(input.notificationTtl)) {
    payload.notification_ttl = input.notificationTtl;
  }
  if (typeof input.showOnCalendar === 'boolean') payload.show_on_calendar = input.showOnCalendar;
  if (typeof input.points === 'number' && Number.isFinite(input.points)) {
    payload.points = Math.max(0, Math.round(input.points));
  }
  if (input.description?.trim()) payload.description = input.description.trim();
  const createLabels = Array.from(
    new Set((input.labels ?? []).map((label) => label.trim()).filter(Boolean)),
  );
  if (createLabels.length > 0) payload.labels = createLabels;
  if (input.frequency) payload.frequency = input.frequency;

  if (
    ['custom', 'custom_from_complete', 'custom_from_complete_date_only'].includes(
      input.frequency ?? '',
    ) &&
    input.customInterval
  ) {
    payload.custom_interval = Math.max(1, Math.round(input.customInterval));
    if (input.customIntervalUnit) payload.custom_interval_unit = input.customIntervalUnit;
  }
  if (input.frequency === 'weekly' && input.applicableDays?.length) {
    payload.applicable_days = input.applicableDays.filter((day) => CHORESMAN_WEEKDAYS.includes(day));
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
  /** ChoresMan internal id. */
  choreId?: string;
  /** Current chore name used as the lookup key when no `choreId` is available. */
  targetName?: string;
  /** New chore name, or the current name when no rename is requested. */
  name: string;
  /** Replaces the full assignee list when given. */
  assignedUserNames?: string[];
  points?: number;
  description?: string;
  /** Replaces the chore label list when given. */
  labels?: string[];
  frequency?: string;
  customInterval?: number;
  customIntervalUnit?: ChoresManIntervalUnit;
  applicableDays?: string[];
  /** ISO date/time. */
  dueDate?: string;
  /** Due window offset, e.g. `1h`, `1d 6h`, or `0` to disable. */
  windowOffset?: string;
  /** Due reminder offset; omitted means "leave the current reminder alone". */
  reminderOffset?: string;
  autoApprove?: boolean;
  notificationChannel?: string | null;
  notificationImportance?: string | null;
  notificationPriority?: string | null;
  notificationTtl?: number | null;
  showOnCalendar?: boolean;
}

/**
 * Build the ChoresMan update chore payload.
 *
 * Only the fields the caller actually resolved are included, so editing one
 * property never resets the others. Returns `null` when the chore name is
 * missing.
 *
 * ChoresMan only accepts `completion_criteria` on creation, not updates.
 *
 * Note: ChoresMan rejects a schedule change with "The requested changes require
 * a future due date", so callers must send `dueDate` alongside `frequency`.
 */
export function buildUpdateChorePayload(input: UpdateChoreInput): Record<string, unknown> | null {
  const name = input.name.trim();
  const targetName = (input.targetName ?? name).trim();
  if (!name || (!input.choreId && !targetName)) return null;
  // Without an internal ID ChoresMan interprets `name` as the lookup key and
  // ignores it as an update field. Never accidentally turn a rename into a
  // failed lookup against the new name.
  if (!input.choreId && targetName !== name) return null;

  const payload: Record<string, unknown> = {
    ...(input.choreId ? { id: input.choreId, name } : { name: targetName }),
  };

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
    // An empty array is meaningful: it clears the chore labels. Only a missing
    // property means "leave them alone".
    payload.labels = Array.from(new Set(input.labels.map((label) => label.trim()).filter(Boolean)));
  }
  if (input.frequency) payload.frequency = input.frequency;

  if (
    input.customInterval &&
    ['custom', 'custom_from_complete', 'custom_from_complete_date_only'].includes(
      input.frequency ?? '',
    )
  ) {
    payload.custom_interval = Math.max(1, Math.round(input.customInterval));
    if (input.customIntervalUnit) payload.custom_interval_unit = input.customIntervalUnit;
  }
  if (input.applicableDays !== undefined) {
    payload.applicable_days = input.applicableDays.filter((day): day is ChoresManWeekday =>
      CHORESMAN_WEEKDAYS.includes(day as ChoresManWeekday),
    );
  }
  if (input.dueDate) payload.due_date = input.dueDate;
  if (input.windowOffset !== undefined) {
    // An empty field means "no window"; ChoresMan spells that as `0`.
    payload.due_window_offset = input.windowOffset.trim() || '0';
  }
  if (input.reminderOffset?.trim()) payload.due_reminder_offset = input.reminderOffset.trim();
  if (typeof input.autoApprove === 'boolean') payload.auto_approve = input.autoApprove;
  if (input.notificationChannel) payload.notification_channel = input.notificationChannel;
  if (input.notificationImportance) payload.notification_importance = input.notificationImportance;
  if (input.notificationPriority) payload.notification_priority = input.notificationPriority;
  if (typeof input.notificationTtl === 'number' && Number.isInteger(input.notificationTtl)) {
    payload.notification_ttl = input.notificationTtl;
  }
  if (typeof input.showOnCalendar === 'boolean') payload.show_on_calendar = input.showOnCalendar;

  return payload;
}

export interface CreateRewardInput {
  name: string;
  /** Points needed to redeem it. */
  cost: number;
  /** ChoresMan user names — rewards are per user, so this is who can see it. */
  assignedUserNames: string[];
  description?: string | null;
  /** Require a parent to approve this definition before a child can use it. */
  approvalRequired?: boolean;
}

/**
 * Build the ChoresMan create reward payload.
 *
 * ChoresMan shows one reward row per assigned member, so `assigned_user_names`
 * determines which family members can claim it.
 */
export function buildCreateRewardPayload(input: CreateRewardInput): Record<string, unknown> | null {
  const name = input.name.trim();
  const users = Array.from(
    new Set(input.assignedUserNames.map((userName) => userName.trim()).filter(Boolean)),
  );
  if (!name || users.length === 0) return null;

  const payload: Record<string, unknown> = {
    name,
    cost: Math.max(1, Math.round(input.cost)),
    assigned_user_names: users,
  };
  if (input.description?.trim()) payload.description = input.description.trim();
  if (input.approvalRequired) payload.approved = false;

  return payload;
}

export interface UpdateRewardInput {
  /**
   * The reward's current name — the handle ChoresMan resolves it by. Renaming
   * needs the internal reward id, which the edit form does not expose.
   */
  name: string;
  cost?: number;
  /** Replaces the users who can see and claim the reward when provided. */
  assignedUserNames?: string[];
}

/** Build the ChoresMan update reward payload. */
export function buildUpdateRewardPayload(input: UpdateRewardInput): Record<string, unknown> | null {
  const name = input.name.trim();
  if (!name) return null;

  const payload: Record<string, unknown> = { name };
  if (typeof input.cost === 'number' && Number.isFinite(input.cost)) {
    payload.cost = Math.max(1, Math.round(input.cost));
  }
  if (input.assignedUserNames !== undefined) {
    payload.assigned_user_names = Array.from(
      new Set(input.assignedUserNames.map((userName) => userName.trim()).filter(Boolean)),
    );
  }

  return payload;
}

/**
 * Convert an expanded ChoresMan offset string (`"0d 1h 0m"`) into its compact
 * form (`"1h"`).
 * Returns `""` when the offset is zero, which means "no window".
 */
export function formatChoresManOffset(raw: string | null | undefined): string {
  if (!raw) return '';
  const days = Number(/(\d+)\s*d/.exec(raw)?.[1] ?? 0);
  const hours = Number(/(\d+)\s*h/.exec(raw)?.[1] ?? 0);
  const minutes = Number(/(\d+)\s*m/.exec(raw)?.[1] ?? 0);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : '']
    .filter(Boolean)
    .join(' ');
}

export interface ChoresManChoreGroup {
  key: string;
  member: FamilyMember | null;
  label: string;
  chores: ChoresManChore[];
}

/** Group chores by ChoresMan user, retaining empty user columns and a shared group. */
export function groupChoresManChores(
  users: ChoresManUser[],
  chores: ChoresManChore[],
  members: FamilyMember[],
  sharedLabel: string,
): ChoresManChoreGroup[] {
  const groups = new Map<string, ChoresManChoreGroup>();
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

/**
 * Adapter: Home Assistant ChoreOps → chore planner view model.
 *
 * The planner UI renders one shape (`PlannerTask`/`PlannerMember`/`PlannerGoal`). This
 * module maps ChoreOps' real entities onto it so the same board can be powered
 * by the integration instead of any local sample data.
 *
 * ChoreOps stays authoritative: status, points, and action entity ids all come
 * from its entities, and people are rendered with Abbai Flow family settings
 * (photo, avatar, colour, display name) joined by `choreops_user` or name.
 */
import { resolveMemberForUser } from './choreops';
import {
  emptyMeta,
  findRoutine,
  normaliseName,
  routineIdForTask,
  routineTaskOrder,
  type PlannerMeta,
} from './planner-meta';
import type {
  PlannerGoal,
  PlannerMember,
  PlannerRoutine,
  PlannerTask,
  PlannerTaskAudience,
  PlannerTaskStatus,
  PlannerTimeBlock,
} from './chore-planner-model';
import type { ChoreOpsChore, ChoreOpsState } from '../types/choreops';
import type { FamilyMember } from '../types/family';

export interface ChorePlannerView {
  members: PlannerMember[];
  tasks: PlannerTask[];
  /** Daily repeating chores, grouped by their ChoreOps label. */
  routines: PlannerRoutine[];
  goals: PlannerGoal[];
  /** True when ChoreOps published at least one user or chore. */
  available: boolean;
}

/**
 * ChoreOps statuses that mean the child finished and a parent must sign off.
 * `pending` is deliberately excluded: ChoreOps means "not done yet" by it.
 */
const AWAITING_REVIEW = /(claim|review|progress|submit)/i;
const COMPLETED = /^(approved|completed|done)/i;
const LATE = /(overdue|late|missed)/i;

/** Map a ChoreOps status string onto the planner's status vocabulary. */
export function choreOpsTaskStatus(status: string): PlannerTaskStatus {
  if (COMPLETED.test(status)) return 'completed';
  if (LATE.test(status)) return 'late';
  return 'active';
}

/** Common ChoreOps (mdi) icons mapped to the planner's emoji vocabulary. */
const MDI_EMOJI: Array<[RegExp, string]> = [
  [/vacuum/i, '\u{1F9F9}'],
  [/silverware|dish|plate/i, '\u{1F37D}'],
  [/bed/i, '\u{1F6CF}'],
  [/tooth|brush/i, '\u{1FAE5}'],
  [/broom|sweep/i, '\u{1F9F9}'],
  [/trash|delete/i, '\u{1F5D1}'],
  [/cat|dog|paw|pet/i, '\u{1F43E}'],
  [/plant|flower|watering/i, '\u{1FAB4}'],
  [/bag|backpack|school/i, '\u{1F392}'],
  [/tshirt|washing|laundry|shoe/i, '\u{1F9FA}'],
];

/**
 * ChoreOps icons are usually `mdi:*` keys; the planner shows an emoji.
 * Returns `null` when ChoreOps has no icon (or one we cannot map) so the card
 * can skip the badge instead of showing a generic placeholder.
 */
function plannerIcon(icon: string | null): string | null {
  if (!icon) return null;
  if (!icon.includes(':')) return icon;
  const match = MDI_EMOJI.find(([pattern]) => pattern.test(icon));
  return match ? match[1] : null;
}

/** Stable planner member id that cannot collide with a locally derived member. */
function memberIdFor(userName: string, member: FamilyMember | null): string {
  return member ? member.id : `choreops:${userName.trim().toLowerCase()}`;
}

/**
 * ChoreOps writes this state on the *other* assignees of a `shared_first`
 * chore once somebody has taken it. It is not "done for them": the chore is
 * simply no longer theirs, so the planner drops it instead of showing a
 * completed card on every child's board.
 */
const TAKEN_BY_SOMEONE_ELSE = /completed_by_other/i;

/** ChoreOps repeats that mean "every day" — the raw material for a routine. */
const DAILY_FREQUENCY = /^daily/i;

/**
 * A routine is a group of daily chores that share a ChoreOps label, so a
 * household names them in ChoreOps ("Ochtendroutine", "Bedtijd") and Abbai Flow
 * simply shows what ChoreOps published. Returns null when the chore has no
 * label; those chores still count as daily work, just without a routine name.
 */
function routineLabel(chore: ChoreOpsChore): string | null {
  const label = (chore.labels ?? []).map((item) => item.trim()).find(Boolean);
  return label ?? null;
}

/** Morning/afternoon/evening from the earliest due time in a routine. */
function timeBlockFor(dueDate: string | null | undefined): PlannerTimeBlock {
  if (!dueDate) return 'morning';
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 'morning';
  const hour = due.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Daily chores reset at midnight in ChoreOps, so a completion from an earlier
 * day is yesterday's work and must not sit in today's "done" list.
 */
function completedToday(chore: ChoreOpsChore, now: Date): boolean {
  if (!chore.lastCompleted) return true;
  const done = new Date(chore.lastCompleted);
  if (Number.isNaN(done.getTime())) return true;
  return done.toDateString() === now.toDateString();
}

/**
 * Statuses where a `shared_first` chore is still waiting to be picked up.
 * Everything else (claimed, completed, ...) means one child has it now, and
 * from that moment the card should look like a normal assigned chore.
 */
const STILL_UP_FOR_GRABS = /^(pending|due|waiting|overdue|missed|standby|not_my_turn|unknown)$/i;

/**
 * Who a chore is for.
 *
 * `shared_first` means "anyone can take it": the first child to finish keeps
 * the points and the others are relieved of it. Once one child claimed it, it
 * is that child's chore and the card shows them like any other assignment.
 * `shared_all` (or a chore assigned to the whole household) is "everyone".
 * Anything else belongs to the one assignee on the card.
 */
export function choreAudience(
  chore: Pick<ChoreOpsChore, 'completionCriteria' | 'assignedUserNames' | 'status'>,
  userCount: number,
): PlannerTaskAudience {
  const criteria = (chore.completionCriteria ?? '').trim().toLowerCase();
  if (criteria === 'shared_first') {
    return STILL_UP_FOR_GRABS.test(chore.status) ? 'anyone' : 'member';
  }
  if (criteria === 'shared_all') return 'everyone';

  const assigned = new Set(
    (chore.assignedUserNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  if (assigned.size > 1 && assigned.size >= userCount) return 'everyone';
  return 'member';
}

export function buildChorePlannerView(
  state: ChoreOpsState | null,
  family: FamilyMember[],
  now: Date = new Date(),
  /**
   * Abbai Flow-owned routine registry. ChoreOps has no routine entity and no
   * ordering, so routine identity and step order come from here; its ChoreOps
   * label remains the fallback for groups that were never adopted.
   */
  meta: PlannerMeta = emptyMeta(),
): ChorePlannerView {
  const users = state?.users ?? [];

  const members: PlannerMember[] = users.map((user) => {
    const member = resolveMemberForUser(user.name, family);
    return {
      id: memberIdFor(user.name, member),
      name: member?.name ?? user.name,
      avatar: member?.avatar ?? '\u{1F464}',
      photo: member?.photo,
      color: member?.color ?? '#cf6d55',
      savings: user.points,
    };
  });

  const memberIds = new Set(members.map((member) => member.id));

  const tasks: PlannerTask[] = (state?.chores ?? [])
    // Another child already took this shared_first chore; it is no longer on
    // this child's list, and ChoreOps only awards points to whoever did it.
    .filter((chore) => {
      if (TAKEN_BY_SOMEONE_ELSE.test(chore.status)) return false;
      // A daily chore finished on an earlier day is not today's completion.
      const finished = choreOpsTaskStatus(chore.status) === 'completed';
      if (finished && DAILY_FREQUENCY.test(chore.frequency ?? '') && !completedToday(chore, now)) {
        return false;
      }
      return true;
    })
    .map((chore) => {
      const member = resolveMemberForUser(chore.assignee, family);
      const assignedId = chore.assignee ? memberIdFor(chore.assignee, member) : null;
      const status = choreOpsTaskStatus(chore.status);
      const awaitingReview = AWAITING_REVIEW.test(chore.status);
      // Only daily chores belong to a routine, matching how the routine rows
      // are grouped; a weekly chore keeps its ChoreOps label but is a one-off.
      const label = DAILY_FREQUENCY.test(chore.frequency ?? '') ? routineLabel(chore) : null;
      const routineId = DAILY_FREQUENCY.test(chore.frequency ?? '')
        ? routineIdForTask(meta, chore.name, label)
        : null;
      const routine = routineId ? findRoutine(meta, routineId) : null;
      const order = routineId ? routineTaskOrder(meta, routineId) : [];
      const position = order.findIndex((name) => normaliseName(name) === normaliseName(chore.name));

      return {
        id: chore.id,
        name: chore.name,
        icon: plannerIcon(chore.icon),
        points: chore.points ?? 0,
        // A chore whose assignee has no ChoreOps user falls back to unassigned
        // so it renders in the shared column instead of a phantom person.
        memberId: assignedId && memberIds.has(assignedId) ? assignedId : null,
        kind: 'task',
        startsAt: new Date(0).toISOString(),
        deadlineAt: chore.dueDate ?? null,
        expiresAt: null,
        retryMinutes: null,
        timeBlock: 'custom',
        statusOverride: status,
        audience: choreAudience(chore, users.length),
        // Kept regardless of status: see `freeForAll` on PlannerTask.
        freeForAll: (chore.completionCriteria ?? '').trim().toLowerCase() === 'shared_first',
        awaitingReview,
        autoApprove: chore.autoApprove ?? false,
        actions: chore.actions,
        routineId: routineId ?? undefined,
        routineName: routine?.name ?? label ?? undefined,
        // A routine step is not an individual chore: the board hides these from
        // the member column and the missions run is the only way to do them.
        inRoutine: Boolean(routineId),
        routineOrder: position >= 0 ? position + 1 : undefined,
      } satisfies PlannerTask;
    });

  /*
   * Routines are the daily chores, grouped by their ChoreOps label. One entry
   * per label (not per child) so "Ochtendroutine" reads the same whoever the
   * group happens to be listed under; `memberIds` records who does it.
   */
  const routineBuckets = new Map<
    string,
    {
      name: string;
      icon: string | null;
      memberIds: Set<string>;
      points: number;
      dueDate: string | null;
      taskNames: Set<string>;
      paused: boolean;
    }
  >();

  /**
   * Daily chores without a label. They only join the routine section once the
   * household has at least one *named* routine: on its own this bucket used to
   * produce a "Routines" bar for plain daily chores, which reads like a bug.
   * Mixing them in keeps everything that repeats daily in one place as soon as
   * routines are actually in use.
   */
  const unlabelledBucket = {
    icon: null as string | null,
    memberIds: new Set<string>(),
    points: 0,
    dueDate: null as string | null,
  };

  for (const chore of state?.chores ?? []) {
    if (!DAILY_FREQUENCY.test(chore.frequency ?? '')) continue;
    if (!chore.assignee) continue;

    const member = resolveMemberForUser(chore.assignee, family);
    const memberId = memberIdFor(chore.assignee, member);
    const label = routineLabel(chore);
    const routineId = routineIdForTask(meta, chore.name, label);

    // A daily chore that belongs to no routine at all is collected separately.
    if (!routineId) {
      if (memberIds.has(memberId)) unlabelledBucket.memberIds.add(memberId);
      unlabelledBucket.points += chore.points ?? 0;
      unlabelledBucket.icon ??= plannerIcon(chore.icon);
      if (
        chore.dueDate &&
        (!unlabelledBucket.dueDate || chore.dueDate < unlabelledBucket.dueDate)
      ) {
        unlabelledBucket.dueDate = chore.dueDate;
      }
      continue;
    }

    const definition = findRoutine(meta, routineId);
    const bucket = routineBuckets.get(routineId) ?? {
      // The registry owns the display name; a legacy label is only a fallback.
      name: definition?.name ?? label ?? '',
      icon: definition?.icon ?? plannerIcon(chore.icon),
      memberIds: new Set<string>(),
      points: 0,
      dueDate: null,
      taskNames: new Set<string>(),
      paused: definition?.paused ?? false,
    };

    if (memberIds.has(memberId)) bucket.memberIds.add(memberId);
    bucket.points += chore.points ?? 0;
    bucket.taskNames.add(chore.name);
    if (chore.dueDate && (!bucket.dueDate || chore.dueDate < bucket.dueDate)) {
      bucket.dueDate = chore.dueDate;
    }
    routineBuckets.set(routineId, bucket);
  }

  const routines: PlannerRoutine[] = Array.from(routineBuckets.entries()).map(([key, bucket]) => {
    const order = routineTaskOrder(meta, key);
    const known = order.filter((name) =>
      Array.from(bucket.taskNames).some((live) => normaliseName(live) === normaliseName(name)),
    );
    const unordered = Array.from(bucket.taskNames).filter(
      (live) => !known.some((name) => normaliseName(name) === normaliseName(live)),
    );
    return {
      id: key,
      name: bucket.name,
      icon: bucket.icon ?? '\u23F0',
      memberIds: Array.from(bucket.memberIds),
      frequency: 'daily' as const,
      timeBlock: timeBlockFor(bucket.dueDate),
      points: bucket.points,
      // Registry order first, then anything ChoreOps has that the registry does
      // not know yet (a chore added in HA without touching Abbai Flow).
      taskNames: [...known, ...unordered],
      paused: bucket.paused,
    };
  });

  // Only added when a named routine exists, so a household without routines
  // never gets a bar full of plain daily chores.
  if (routines.length > 0 && unlabelledBucket.memberIds.size > 0) {
    routines.push({
      id: 'routine:__unlabelled__',
      name: '',
      icon: unlabelledBucket.icon ?? '\u23F0',
      memberIds: Array.from(unlabelledBucket.memberIds),
      frequency: 'daily' as const,
      timeBlock: timeBlockFor(unlabelledBucket.dueDate),
      points: unlabelledBucket.points,
      fallback: true,
    });
  }

  const goals: PlannerGoal[] = (state?.rewards ?? []).map((reward) => {
    const member = resolveMemberForUser(reward.assignee, family);
    const id = reward.assignee ? memberIdFor(reward.assignee, member) : null;
    return {
      id: reward.id,
      title: reward.name,
      icon: '\u{1F381}',
      target: Math.max(1, reward.cost),
      progress: 0,
      memberIds: id && memberIds.has(id) ? [id] : [],
    };
  });

  return {
    members,
    tasks,
    routines,
    goals,
    available: Boolean(state?.available && (users.length > 0 || tasks.length > 0)),
  };
}

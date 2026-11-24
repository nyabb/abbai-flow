/**
 * Adapter: Home Assistant ChoreOps → chore planner view model.
 *
 * The planner UI renders one shape (`PlannerTask`/`PlannerMember`/`PlannerGoal`). This
 * module maps ChoreOps' real entities onto it so the same board can be powered
 * by the integration instead of any local sample data.
 *
 * ChoreOps owns chore status and points. Family routines are loaded separately
 * from Abbai Flow's family store and never inferred from ChoreOps labels.
 * People are rendered with Abbai Flow family settings (photo, avatar, colour,
 * display name) joined by `choreops_user` or name.
 */
import { isChoreOpenToAnyone, resolveMemberForUser } from './choreops';
import type {
  PlannerGoal,
  PlannerMember,
  PlannerTask,
  PlannerTaskAudience,
  PlannerTaskStatus,
} from './chore-planner-model';
import type { ChoreOpsChore, ChoreOpsState } from '../types/choreops';
import type { FamilyMember } from '../types/family';

export interface ChorePlannerView {
  members: PlannerMember[];
  /** All live chores, including stale completed routine steps kept off the board. */
  allTasks: PlannerTask[];
  tasks: PlannerTask[];
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

/** ChoreOps repeats that mean "every day" for stale-completion filtering. */
const DAILY_FREQUENCY = /^daily/i;

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
    if (!isChoreOpenToAnyone(chore)) return 'member';
    return STILL_UP_FOR_GRABS.test(chore.status) ? 'anyone' : 'member';
  }
  if (criteria === 'shared_all') {
    const assignedCount = new Set(
      (chore.assignedUserNames ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean),
    ).size;
    return assignedCount === 1 ? 'member' : 'everyone';
  }

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
): ChorePlannerView {
  const users = state?.users ?? [];

  const members: PlannerMember[] = users.map((user) => {
    const member = resolveMemberForUser(user.name, family);
    return {
      id: memberIdFor(user.name, member),
      name: member?.name ?? user.name,
      avatar: member?.avatar ?? '\u{1F464}',
      role: member?.role ?? 'child',
      photo: member?.photo,
      color: member?.color ?? '#cf6d55',
      savings: user.points,
    };
  });

  const memberIds = new Set(members.map((member) => member.id));

  const choreTasks = (state?.chores ?? [])
    // Another child already took this shared_first chore; it is no longer on
    // this child's list, and ChoreOps only awards points to whoever did it.
    .filter((chore) => !TAKEN_BY_SOMEONE_ELSE.test(chore.status))
    .map((chore) => {
      const member = resolveMemberForUser(chore.assignee, family);
      const assignedId = chore.assignee ? memberIdFor(chore.assignee, member) : null;
      const status = choreOpsTaskStatus(chore.status);
      const awaitingReview = AWAITING_REVIEW.test(chore.status);

      return {
        chore,
        task: {
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
          completedAt: chore.lastCompleted ?? undefined,
          audience: choreAudience(chore, users.length),
          // Kept regardless of status: see `freeForAll` on PlannerTask.
          freeForAll: isChoreOpenToAnyone(chore),
          awaitingReview,
          autoApprove: chore.autoApprove ?? false,
          actions: chore.actions,
        } satisfies PlannerTask,
      };
    });
  const allTasks = choreTasks.map(({ task }) => task);
  const tasks = choreTasks
    .filter(({ chore }) => {
      // A daily chore finished on an earlier day is yesterday's work and stays
      // off today's board. Its routine schedule belongs to ChoreOps, but its
      // grouping and task identity do not define an Abbai Flow routine.
      const finished = choreOpsTaskStatus(chore.status) === 'completed';
      return !(
        finished &&
        DAILY_FREQUENCY.test(chore.frequency ?? '') &&
        !completedToday(chore, now)
      );
    })
    .map(({ task }) => task);

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
    allTasks,
    tasks,
    goals,
    available: Boolean(state?.available && (users.length > 0 || tasks.length > 0)),
  };
}

/**
 * Adapter: Home Assistant ChoreOps → chore planner view model.
 *
 * The planner UI renders one shape (`PlannerTask`/`PlannerMember`/`PlannerGoal`). This
 * module maps ChoreOps' real entities onto it so the same board can be powered
 * by the integration instead of any local sample data.
 *
 * ChoreOps stays authoritative: status, points, and action entity ids all come
 * from its entities, and people are rendered with Beacon family settings
 * (photo, avatar, colour, display name) joined by `choreops_user` or name.
 */
import { resolveMemberForUser } from './choreops';
import type {
  PlannerGoal,
  PlannerMember,
  PlannerTask,
  PlannerTaskStatus,
} from './chore-planner-model';
import type { ChoreOpsState } from '../types/choreops';
import type { FamilyMember } from '../types/family';

export interface ChorePlannerView {
  members: PlannerMember[];
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

export function buildChorePlannerView(
  state: ChoreOpsState | null,
  family: FamilyMember[],
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

  const tasks: PlannerTask[] = (state?.chores ?? []).map((chore) => {
    const member = resolveMemberForUser(chore.assignee, family);
    const assignedId = chore.assignee ? memberIdFor(chore.assignee, member) : null;
    const status = choreOpsTaskStatus(chore.status);
    const awaitingReview = AWAITING_REVIEW.test(chore.status);

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
      awaitingReview,
      actions: chore.actions,
    } satisfies PlannerTask;
  });

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
    goals,
    available: Boolean(state?.available && (users.length > 0 || tasks.length > 0)),
  };
}

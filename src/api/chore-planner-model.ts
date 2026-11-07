export type PlannerTaskStatus = 'upcoming' | 'active' | 'late' | 'retry' | 'expired' | 'completed';
export type PlannerTaskKind = 'task' | 'routine';
export type PlannerTimeBlock = 'morning' | 'afternoon' | 'evening' | 'custom';
/**
 * Who a chore is for:
 * - `member`: one particular child (the usual case)
 * - `anyone`: several children share one chore and whoever gets there first
 *   takes it (ChoreOps `shared_first`)
 * - `everyone`: the same chore is assigned to the whole household
 */
export type PlannerTaskAudience = 'member' | 'anyone' | 'everyone';

export interface PlannerMember {
  id: string;
  name: string;
  avatar: string;
  /** Beacon family photo (data URL or HA path); emoji is the fallback. */
  photo?: string;
  color: string;
  savings: number;
}

export interface PlannerTask {
  id: string;
  name: string;
  /** Emoji shown in the card badge; `null` when ChoreOps has no icon. */
  icon: string | null;
  points: number;
  memberId: string | null;
  kind: PlannerTaskKind;
  startsAt: string;
  deadlineAt: string | null;
  expiresAt: string | null;
  retryMinutes: number | null;
  timeBlock: PlannerTimeBlock;
  customStart?: string;
  customEnd?: string;
  completedAt?: string;
  awardDestination?: 'pot' | string;
  awardPotAmount?: number;
  awardGoalAmount?: number;
  /** Live ChoreOps task: status comes from ChoreOps, not from local dates. */
  statusOverride?: PlannerTaskStatus;
  /** Who the chore is meant for; drives the "anyone"/"everyone" chip. */
  audience?: PlannerTaskAudience;
  /** Live ChoreOps task: entity ids for claim/approve/decline. */
  actions?: { claim?: string; approve?: string; disapprove?: string };
  /** Live ChoreOps task: the child finished it and a parent must sign off. */
  awaitingReview?: boolean;
}

export interface PlannerRoutine {
  id: string;
  name: string;
  icon: string;
  memberIds: string[];
  frequency: 'daily' | 'weekly' | 'monthly' | 'interval';
  intervalDays?: number;
  weekdays?: number[];
  timeBlock: PlannerTimeBlock;
  customStart?: string;
  customEnd?: string;
  points: number;
  /**
   * "Other daily tasks": daily chores without a ChoreOps label, collected here
   * only once the household has at least one named routine. The UI shows a
   * localized title for this group instead of `name`.
   */
  fallback?: boolean;
}

export interface PlannerGoal {
  id: string;
  title: string;
  icon: string;
  target: number;
  progress: number;
  memberIds: string[];
}

export interface ChorePlannerState {
  members: PlannerMember[];
  tasks: PlannerTask[];
  routines: PlannerRoutine[];
  goals: PlannerGoal[];
  routinesPaused: boolean;
  soundEnabled: boolean;
}

export function getPlannerTaskStatus(task: PlannerTask, now = new Date()): PlannerTaskStatus {
  if (task.statusOverride) return task.statusOverride;
  if (task.completedAt) return 'completed';

  const nowMs = now.getTime();
  if (!task.memberId && task.expiresAt && nowMs >= new Date(task.expiresAt).getTime()) {
    return 'expired';
  }
  if (nowMs < new Date(task.startsAt).getTime()) return 'upcoming';

  if (task.deadlineAt && nowMs >= new Date(task.deadlineAt).getTime()) {
    const retryUntil = task.retryMinutes
      ? new Date(new Date(task.deadlineAt).getTime() + task.retryMinutes * 60_000).getTime()
      : 0;
    if (retryUntil && nowMs < retryUntil) return 'retry';
    return 'late';
  }

  return 'active';
}

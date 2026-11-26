/** ChoresMan records mapped into the planner's member and action model. */

export type ChoresManActionKind = 'take' | 'claim' | 'approve' | 'disapprove';

export type ChoresManActions = Partial<Record<ChoresManActionKind, string>>;

export interface ChoresManChore {
  /** Stable planner row id; a shared chore can have one row per member. */
  id: string;
  /** ChoresMan store id used for writes that target the chore directly. */
  sourceId?: string;
  /** Stable planner row id used to find the underlying chore record. */
  plannerRowId?: string;
  name: string;
  icon: string | null;
  status: string;
  assignee: string | null;
  points: number | null;
  dueDate?: string | null;
  showOnCalendar?: boolean;
  description?: string | null;
  frequency?: string | null;
  applicableDays?: string[];
  labels?: string[];
  customInterval?: number | null;
  customIntervalUnit?: string | null;
  approvalReset?: string | null;
  pendingClaims?: string | null;
  overdueHandling?: string | null;
  claimLockUntilWindow?: boolean;
  notificationChannel?: string | null;
  notificationImportance?: string | null;
  notificationPriority?: string | null;
  notificationTtl?: number | null;
  lastCompleted?: string | null;
  windowOffset?: string | null;
  autoApprove?: boolean;
  assignedUserNames?: string[];
  completionCriteria?: string | null;
  canClaim: boolean;
  canApprove: boolean;
  actions: ChoresManActions;
}

export interface ChoresManReward {
  id: string;
  name: string;
  status: string;
  cost: number;
  pendingClaims: number;
  approvalPending?: boolean;
  assignee: string | null;
  actions: ChoresManActions;
}

export interface ChoresManUser {
  name: string;
  /** ChoresMan member id, mirrored from Abbai Flow's family profile id. */
  slug: string;
  points: number;
  dueToday: number;
  claimed: number;
  approved: number;
  completedToday: number;
}

export interface ChoresManState {
  users: ChoresManUser[];
  chores: ChoresManChore[];
  rewards: ChoresManReward[];
  pointsByUser: Record<string, number>;
  pendingApprovals: { chores: number; rewards: number };
  available: boolean;
}

/**
 * ChoreOps (HA custom integration) data shapes.
 *
 * Verified against a live ChoreOps 1.6.0 instance. ChoreOps does NOT expose
 * per-chore status sensors; per-chore data lives in the `chores` attribute of
 * each user's `purpose_dashboard_helper` sensor. Every ChoreOps entity carries
 * a `purpose` attribute, which is the reliable discovery key (entity_id
 * patterns are slugified user names and therefore not stable).
 */

/** Minimal HA state shape as returned by HomeAssistantClient.getStates(). */
export interface ChoreOpsEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export type ChoreOpsActionKind = 'claim' | 'approve' | 'disapprove';

export type ChoreOpsActions = Partial<Record<ChoreOpsActionKind, string>>;

export interface ChoreOpsChore {
  /** Stable key: ChoreOps `eid` when present, otherwise a name-derived id. */
  id: string;
  /** Per-user ChoreOps status sensor, used to read its Recorder history. */
  statusEntityId?: string;
  name: string;
  icon: string | null;
  status: string;
  assignee: string | null;
  /** Reward for completing it, when ChoreOps exposes one. */
  points: number | null;
  /** Due date/time ChoreOps publishes for this chore, when available. */
  dueDate?: string | null;
  /** Free-text description, mirrored from the per-user status sensor. */
  description?: string | null;
  /** Repeat setting as ChoreOps names it (`daily`, `weekly`, `custom`, ...). */
  frequency?: string | null;
  /** Weekday keys (`mon`..`sun`) when the repeat is day-bound. */
  applicableDays?: string[];
  /** ChoreOps labels; Abbai Flow groups daily chores into routines by label. */
  labels?: string[];
  /**
   * ISO timestamp of the last completion. Daily chores reset at midnight, so
   * this is what tells a "done today" card apart from yesterday's.
   */
  lastCompleted?: string | null;
  /** Due window offset as ChoreOps formats it, e.g. `0d 1h 0m`. */
  windowOffset?: string | null;
  /** Whether a completion counts without a parent approving it. */
  autoApprove?: boolean;
  /** Every user ChoreOps has this chore assigned to. */
  assignedUserNames?: string[];
  /**
   * ChoreOps completion rule: `independent`, `shared_all`, `shared_first`
   * (first one wins) or one of the `rotation_*` modes. `shared_first` is how
   * an "anyone can take this" chore is expressed.
   */
  completionCriteria?: string | null;
  canClaim: boolean;
  canApprove: boolean;
  actions: ChoreOpsActions;
}

export interface ChoreOpsReward {
  /** Entity id of the reward status sensor. */
  id: string;
  name: string;
  status: string;
  cost: number;
  pendingClaims: number;
  assignee: string | null;
  actions: ChoreOpsActions;
}

export interface ChoreOpsUser {
  /** `user_name` attribute — the join key to Abbai Flow's FamilyMember.name. */
  name: string;
  /** Entity-id slug, e.g. "maya" in sensor.maya_choreops_points. */
  slug: string;
  points: number;
  dueToday: number;
  claimed: number;
  approved: number;
  completedToday: number;
}

export interface ChoreOpsState {
  users: ChoreOpsUser[];
  chores: ChoreOpsChore[];
  rewards: ChoreOpsReward[];
  /** Every person entity in HA, including people without ChoreOps stats. */
  people: HaPerson[];
  /** Lower-cased user name → points balance, for quick lookups. */
  pointsByUser: Record<string, number>;
  /** Household-wide counters of work waiting for a parent to sign off. */
  pendingApprovals: { chores: number; rewards: number };
  /** ChoreOps config entry id, needed by the service calls that assign/claim. */
  entryId: string | null;
  /** True when ChoreOps entities were found at all. */
  available: boolean;
}

/** A Home Assistant `person.*` entity (may or may not be a ChoreOps user). */
export interface HaPerson {
  entityId: string;
  name: string;
  /** `entity_picture` when the person has a photo set in Home Assistant. */
  picture: string | null;
}

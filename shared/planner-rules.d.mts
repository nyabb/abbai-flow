/**
 * Types for the shared planner rules. Kept separate so the browser bundle gets
 * full type safety while the add-on server can load the plain `.mjs` at runtime.
 */

export type RedemptionState = 'saving' | 'awaiting_fulfilment' | 'fulfilled';

export interface Redemption {
  id: string;
  user: string;
  reward: string;
  rewardLabel: string;
  cost: number;
  points: number;
  state: RedemptionState;
  createdAt: number;
  achievedAt?: number;
  fulfilledAt?: number;
  fulfilledBy?: string;
}

export interface RoutineDefinition {
  id: string;
  name: string;
  icon: string;
  taskNames: string[];
  paused?: boolean;
}

export interface MissionProgress {
  routineId: string;
  completed: string[];
  startedAt: number;
  updatedAt: number;
}

export interface PlannerMeta {
  version: number;
  routines: RoutineDefinition[];
  missions: Record<string, MissionProgress>;
}

export function normaliseName(value: string | null | undefined): string;
export const normalise: typeof normaliseName;
export function routineSlug(name: string): string;

export function activeRedemption(
  redemptions: Redemption[],
  user: string | null | undefined,
  reward: string | null | undefined,
): Redemption | null;

export function addPoints(
  redemptions: Redemption[],
  input: { user: string; reward: string; cost: number; amount: number; at?: number },
): { redemptions: Redemption[]; redemption: Redemption | null };

export function releaseRedemption(
  redemptions: Redemption[],
  id: string | null | undefined,
): Redemption[];

export function fulfilRedemption(
  redemptions: Redemption[],
  id: string | null | undefined,
  by: string | undefined,
  at?: number,
): { redemptions: Redemption[]; redemption: Redemption | null };

export function sanitizeRedemptions(raw: unknown): Redemption[];

export function findRoutine(
  meta: PlannerMeta,
  nameOrId: string | null | undefined,
): RoutineDefinition | null;

export function upsertRoutine(
  meta: PlannerMeta,
  name: string,
  icon?: string,
): { meta: PlannerMeta; routine: RoutineDefinition; created: boolean };

export function renameRoutine(meta: PlannerMeta, id: string, name: string): PlannerMeta;
export function setRoutineTasks(meta: PlannerMeta, id: string, taskNames: string[]): PlannerMeta;
export function addRoutineTask(meta: PlannerMeta, id: string, taskName: string): PlannerMeta;
export function removeRoutineTask(meta: PlannerMeta, id: string, taskName: string): PlannerMeta;
export function moveRoutineTask(
  meta: PlannerMeta,
  id: string,
  taskName: string,
  delta: -1 | 1,
): PlannerMeta;
export function toggleRoutinePaused(meta: PlannerMeta, id: string): PlannerMeta;
export function adoptLabels(
  meta: PlannerMeta,
  groups: Array<{ label: string; taskNames: string[] }>,
): PlannerMeta;
export function pruneRoutineTasks(meta: PlannerMeta, knownChoreNames: string[]): PlannerMeta;
export function importLegacyPauses(meta: PlannerMeta, ids: string[]): PlannerMeta;

export function markMissionTaskDone(
  meta: PlannerMeta,
  userName: string,
  routineId: string,
  taskName: string,
): PlannerMeta;
export function startMission(meta: PlannerMeta, userName: string, routineId: string): PlannerMeta;
export function clearMission(meta: PlannerMeta, userName: string): PlannerMeta;

export function emptyMeta(): PlannerMeta;
export function sanitizePlannerMeta(raw: unknown): PlannerMeta;

export type PlannerTarget = 'meta' | 'redemptions';

export interface PlannerOp {
  type: string;
  [key: string]: unknown;
}

export function applyPlannerOp(
  target: PlannerTarget,
  document: unknown,
  op: PlannerOp,
): { document: unknown; changed: boolean; result: unknown };
